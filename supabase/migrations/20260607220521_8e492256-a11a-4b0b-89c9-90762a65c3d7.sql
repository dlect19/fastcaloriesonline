
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS organizer_access_token text UNIQUE;

UPDATE public.events
  SET organizer_access_token = encode(extensions.gen_random_bytes(24), 'hex')
  WHERE organizer_access_token IS NULL;

CREATE OR REPLACE FUNCTION public.set_event_organizer_token()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organizer_access_token IS NULL THEN
    NEW.organizer_access_token := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_event_organizer_token ON public.events;
CREATE TRIGGER trg_set_event_organizer_token
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_event_organizer_token();

-- RPC: check in a ticket via organizer token (no admin role required, scoped to event)
CREATE OR REPLACE FUNCTION public.check_in_event_ticket_by_token(p_token text, p_lookup text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event RECORD;
  v_ticket RECORD;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE organizer_access_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','unauthorized');
  END IF;

  SELECT * INTO v_ticket FROM public.event_tickets
    WHERE (qr_token = p_lookup OR ticket_code = upper(p_lookup))
      AND event_id = v_event.id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','invalid');
  END IF;

  IF v_ticket.status = 'checked_in' THEN
    RETURN jsonb_build_object('result','already_used','ticket', row_to_json(v_ticket), 'event', row_to_json(v_event));
  END IF;

  IF v_ticket.status IN ('cancelled','refunded','expired') THEN
    RETURN jsonb_build_object('result', v_ticket.status::text, 'ticket', row_to_json(v_ticket));
  END IF;

  UPDATE public.event_tickets
    SET status = 'checked_in', checked_in_at = now()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

  RETURN jsonb_build_object('result','valid','ticket', row_to_json(v_ticket), 'event', row_to_json(v_event));
END $$;

-- Allow regenerating token (admin only via RLS-protected UPDATE on events)
