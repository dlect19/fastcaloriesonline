
CREATE TABLE IF NOT EXISTS public.event_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reminder_type text NOT NULL,
  reference_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, reminder_type, reference_id)
);

GRANT ALL ON public.event_reminders_sent TO service_role;
ALTER TABLE public.event_reminders_sent ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_events_event_date ON public.events(event_date);
CREATE INDEX IF NOT EXISTS idx_event_vouchers_expires_at ON public.event_vouchers(expires_at) WHERE status IN ('generated','reserved');

CREATE OR REPLACE FUNCTION public.cancel_pending_event_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
  v_ticket RECORD;
BEGIN
  SELECT * INTO v_order FROM public.event_ticket_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_PAID');
  END IF;

  FOR v_ticket IN SELECT * FROM public.event_tickets WHERE order_id = p_order_id AND status <> 'cancelled' LOOP
    UPDATE public.event_ticket_types
      SET qty_sold = GREATEST(0, qty_sold - 1)
      WHERE id = v_ticket.ticket_type_id;
  END LOOP;

  UPDATE public.event_tickets SET status = 'cancelled' WHERE order_id = p_order_id;
  UPDATE public.event_ticket_orders SET payment_status = 'cancelled' WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.mark_event_order_paid(p_order_id uuid, p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM public.event_ticket_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF v_order.payment_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CANCELLED');
  END IF;

  UPDATE public.event_ticket_orders
    SET payment_status = 'paid',
        paid_at = now(),
        payment_reference = COALESCE(payment_reference, p_reference)
    WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END $$;
