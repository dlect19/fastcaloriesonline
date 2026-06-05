
-- ============================================================
-- EVENT TICKETING PHASE 1: Foundation
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.event_status AS ENUM ('draft','published','paused','cancelled','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_ticket_status AS ENUM ('unused','checked_in','cancelled','expired','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_order_payment_status AS ENUM ('pending','paid','failed','refunded','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  banner_url TEXT,
  description TEXT,
  location_text TEXT,
  location_lat NUMERIC,
  location_lng NUMERIC,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  organizer TEXT,
  organizer_user_id UUID,
  capacity INTEGER,
  terms TEXT,
  status public.event_status NOT NULL DEFAULT 'draft',
  created_by UUID,
  created_by_type TEXT NOT NULL DEFAULT 'admin', -- admin/vendor/organizer (future)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_status_date ON public.events(status, event_date);

GRANT SELECT ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published events"
  ON public.events FOR SELECT
  USING (status IN ('published','paused','completed'));

CREATE POLICY "Admins manage all events"
  ON public.events FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- event_ticket_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  qty_available INTEGER NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
  qty_sold INTEGER NOT NULL DEFAULT 0 CHECK (qty_sold >= 0),
  max_per_customer INTEGER NOT NULL DEFAULT 10,
  sales_start TIMESTAMPTZ,
  sales_end TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_types_event ON public.event_ticket_types(event_id);

GRANT SELECT ON public.event_ticket_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_ticket_types TO authenticated;
GRANT ALL ON public.event_ticket_types TO service_role;

ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view ticket types of visible events"
  ON public.event_ticket_types FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
      AND e.status IN ('published','paused','completed')
  ));

CREATE POLICY "Admins manage ticket types"
  ON public.event_ticket_types FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- event_ticket_orders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_ticket_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  order_number TEXT NOT NULL UNIQUE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT, -- 'wallet' | 'paystack'
  payment_reference TEXT,
  payment_status public.event_order_payment_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  environment TEXT NOT NULL DEFAULT 'development',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_orders_user ON public.event_ticket_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_event_ticket_orders_event ON public.event_ticket_orders(event_id);

GRANT SELECT, INSERT, UPDATE ON public.event_ticket_orders TO authenticated;
GRANT ALL ON public.event_ticket_orders TO service_role;

ALTER TABLE public.event_ticket_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own ticket orders"
  ON public.event_ticket_orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users create their own ticket orders"
  ON public.event_ticket_orders FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins update ticket orders"
  ON public.event_ticket_orders FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- event_tickets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.event_ticket_orders(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  ticket_type_id UUID NOT NULL REFERENCES public.event_ticket_types(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  ticket_code TEXT NOT NULL UNIQUE,           -- short, human-typeable
  qr_token TEXT NOT NULL UNIQUE,              -- long random for QR
  price NUMERIC(12,2) NOT NULL,
  status public.event_ticket_status NOT NULL DEFAULT 'unused',
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_user ON public.event_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_event ON public.event_tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_order ON public.event_tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_qr ON public.event_tickets(qr_token);

GRANT SELECT, INSERT, UPDATE ON public.event_tickets TO authenticated;
GRANT ALL ON public.event_tickets TO service_role;

ALTER TABLE public.event_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own tickets"
  ON public.event_tickets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage tickets"
  ON public.event_tickets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Helpers: timestamp + code generation
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_event_modules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_events_updated ON public.events;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_event_modules_updated_at();

DROP TRIGGER IF EXISTS trg_event_ticket_types_updated ON public.event_ticket_types;
CREATE TRIGGER trg_event_ticket_types_updated BEFORE UPDATE ON public.event_ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.update_event_modules_updated_at();

DROP TRIGGER IF EXISTS trg_event_ticket_orders_updated ON public.event_ticket_orders;
CREATE TRIGGER trg_event_ticket_orders_updated BEFORE UPDATE ON public.event_ticket_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_event_modules_updated_at();

DROP TRIGGER IF EXISTS trg_event_tickets_updated ON public.event_tickets;
CREATE TRIGGER trg_event_tickets_updated BEFORE UPDATE ON public.event_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_event_modules_updated_at();

-- Generate short ticket code (Crockford-ish base32, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.gen_event_ticket_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'FC-EVT-';
  i INT;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  result := result || '-';
  FOR i IN 1..4 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.gen_event_order_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'EVT-';
  i INT;
BEGIN
  result := result || to_char(now(),'YYMMDD') || '-';
  FOR i IN 1..6 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END $$;

-- ============================================================
-- Atomic purchase: reserves stock, creates order + tickets
-- Called from edge function after payment validated
-- ============================================================
CREATE OR REPLACE FUNCTION public.purchase_event_tickets(
  p_user_id UUID,
  p_event_id UUID,
  p_items JSONB,                -- [{ticket_type_id, quantity}]
  p_payment_method TEXT,
  p_payment_reference TEXT,
  p_environment TEXT DEFAULT 'development'
)
RETURNS TABLE(order_id UUID, order_number TEXT, total NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id UUID;
  v_order_no TEXT;
  v_total NUMERIC := 0;
  v_item JSONB;
  v_tt RECORD;
  v_qty INT;
  v_already INT;
  v_event RECORD;
  v_code TEXT;
  v_qr TEXT;
  i INT;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF v_event.status <> 'published' THEN RAISE EXCEPTION 'EVENT_NOT_ON_SALE'; END IF;

  v_order_no := public.gen_event_order_number();

  INSERT INTO public.event_ticket_orders(
    user_id, event_id, order_number, payment_method, payment_reference, environment, payment_status
  ) VALUES (
    p_user_id, p_event_id, v_order_no, p_payment_method, p_payment_reference, p_environment, 'pending'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::INT;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_tt
      FROM public.event_ticket_types
      WHERE id = (v_item->>'ticket_type_id')::UUID
        AND event_id = p_event_id
        AND is_active = TRUE
      FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_TYPE_NOT_FOUND'; END IF;

    IF v_tt.sales_start IS NOT NULL AND v_tt.sales_start > now() THEN
      RAISE EXCEPTION 'SALES_NOT_STARTED';
    END IF;
    IF v_tt.sales_end IS NOT NULL AND v_tt.sales_end < now() THEN
      RAISE EXCEPTION 'SALES_ENDED';
    END IF;

    IF v_tt.qty_sold + v_qty > v_tt.qty_available THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_tt.name;
    END IF;

    SELECT COALESCE(COUNT(*),0) INTO v_already
      FROM public.event_tickets
      WHERE user_id = p_user_id AND ticket_type_id = v_tt.id
        AND status <> 'cancelled';
    IF v_already + v_qty > v_tt.max_per_customer THEN
      RAISE EXCEPTION 'EXCEEDS_MAX_PER_CUSTOMER:%', v_tt.name;
    END IF;

    UPDATE public.event_ticket_types
      SET qty_sold = qty_sold + v_qty
      WHERE id = v_tt.id;

    FOR i IN 1..v_qty LOOP
      LOOP
        v_code := public.gen_event_ticket_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.event_tickets WHERE ticket_code = v_code);
      END LOOP;
      v_qr := encode(gen_random_bytes(24), 'hex');

      INSERT INTO public.event_tickets(
        order_id, event_id, ticket_type_id, user_id, ticket_code, qr_token, price, status
      ) VALUES (
        v_order_id, p_event_id, v_tt.id, p_user_id, v_code, v_qr, v_tt.price, 'unused'
      );
    END LOOP;

    v_total := v_total + (v_tt.price * v_qty);
  END LOOP;

  UPDATE public.event_ticket_orders
    SET subtotal = v_total, total = v_total
    WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_no, v_total;
END $$;

GRANT EXECUTE ON FUNCTION public.purchase_event_tickets(UUID,UUID,JSONB,TEXT,TEXT,TEXT) TO authenticated, service_role;

-- ============================================================
-- Atomic check-in
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_in_event_ticket(
  p_lookup TEXT,           -- qr_token or ticket_code
  p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ticket RECORD;
  v_event RECORD;
BEGIN
  IF NOT public.has_role(p_staff_id, 'admin') THEN
    RETURN jsonb_build_object('result','unauthorized');
  END IF;

  SELECT * INTO v_ticket FROM public.event_tickets
    WHERE qr_token = p_lookup OR ticket_code = upper(p_lookup)
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','invalid');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;

  IF v_ticket.status = 'checked_in' THEN
    RETURN jsonb_build_object(
      'result','already_used',
      'ticket', row_to_json(v_ticket),
      'event', row_to_json(v_event)
    );
  END IF;

  IF v_ticket.status IN ('cancelled','refunded','expired') THEN
    RETURN jsonb_build_object('result', v_ticket.status::text, 'ticket', row_to_json(v_ticket));
  END IF;

  UPDATE public.event_tickets
    SET status = 'checked_in', checked_in_at = now(), checked_in_by = p_staff_id
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

  RETURN jsonb_build_object(
    'result','valid',
    'ticket', row_to_json(v_ticket),
    'event', row_to_json(v_event)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.check_in_event_ticket(TEXT,UUID) TO authenticated, service_role;
