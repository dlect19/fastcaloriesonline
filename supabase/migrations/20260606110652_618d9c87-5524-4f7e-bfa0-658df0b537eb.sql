
-- Enums
DO $$ BEGIN CREATE TYPE public.voucher_reward_type AS ENUM ('food', 'discount', 'merch'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.voucher_redemption_mode AS ENUM ('venue', 'delivery', 'both'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.voucher_delivery_rule AS ENUM ('free_food_paid_delivery', 'free_food_free_delivery'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.voucher_sponsor AS ENUM ('fastcalories', 'vendor', 'organizer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.voucher_status AS ENUM ('generated', 'reserved', 'redeemed', 'expired', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.voucher_redemption_method AS ENUM ('venue', 'delivery'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Templates
CREATE TABLE IF NOT EXISTS public.event_voucher_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_type_id UUID NOT NULL REFERENCES public.event_ticket_types(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reward_type public.voucher_reward_type NOT NULL DEFAULT 'food',
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  combo_id UUID,
  redemption_mode public.voucher_redemption_mode NOT NULL DEFAULT 'both',
  delivery_rule public.voucher_delivery_rule NOT NULL DEFAULT 'free_food_paid_delivery',
  sponsor public.voucher_sponsor NOT NULL DEFAULT 'fastcalories',
  sponsor_cost_per_voucher NUMERIC(12,2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  expires_hours_after_event INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_voucher_templates_ticket_type ON public.event_voucher_templates(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_evt_voucher_templates_event ON public.event_voucher_templates(event_id);
CREATE INDEX IF NOT EXISTS idx_evt_voucher_templates_vendor ON public.event_voucher_templates(vendor_id);

GRANT SELECT ON public.event_voucher_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_voucher_templates TO authenticated;
GRANT ALL ON public.event_voucher_templates TO service_role;
ALTER TABLE public.event_voucher_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active templates of published events" ON public.event_voucher_templates FOR SELECT
  USING (is_active = true AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.status = 'published'));
CREATE POLICY "Admins manage voucher templates" ON public.event_voucher_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Vendors view templates for their vendor" ON public.event_voucher_templates FOR SELECT TO authenticated
  USING (vendor_id IS NOT NULL AND public.owns_vendor(auth.uid(), vendor_id));

-- Vouchers
CREATE TABLE IF NOT EXISTS public.event_vouchers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_code TEXT NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  template_id UUID NOT NULL REFERENCES public.event_voucher_templates(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  combo_id UUID,
  reward_type public.voucher_reward_type NOT NULL DEFAULT 'food',
  sponsor public.voucher_sponsor NOT NULL DEFAULT 'fastcalories',
  sponsor_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.voucher_status NOT NULL DEFAULT 'generated',
  redemption_method public.voucher_redemption_method,
  reserved_at TIMESTAMPTZ,
  reserved_order_id UUID,
  redeemed_at TIMESTAMPTZ,
  redeemed_vendor_id UUID,
  redeemed_by UUID,
  redeemed_order_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_vouchers_user ON public.event_vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_vouchers_ticket ON public.event_vouchers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_evt_vouchers_vendor ON public.event_vouchers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_evt_vouchers_status ON public.event_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_evt_vouchers_event ON public.event_vouchers(event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_vouchers TO authenticated;
GRANT ALL ON public.event_vouchers TO service_role;
ALTER TABLE public.event_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own vouchers" ON public.event_vouchers FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins manage all vouchers" ON public.event_vouchers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Vendors view vouchers for their vendor" ON public.event_vouchers FOR SELECT TO authenticated
  USING (vendor_id IS NOT NULL AND public.owns_vendor(auth.uid(), vendor_id));

-- Settlements ledger
CREATE TABLE IF NOT EXISTS public.voucher_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id UUID NOT NULL REFERENCES public.event_vouchers(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  vendor_id UUID,
  sponsor public.voucher_sponsor NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  redemption_method public.voucher_redemption_method NOT NULL,
  order_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_settlements_voucher ON public.voucher_settlements(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_settlements_event ON public.voucher_settlements(event_id);

GRANT SELECT, INSERT ON public.voucher_settlements TO authenticated;
GRANT ALL ON public.voucher_settlements TO service_role;
ALTER TABLE public.voucher_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all voucher settlements" ON public.voucher_settlements FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Vendors view own settlements" ON public.voucher_settlements FOR SELECT TO authenticated
  USING (vendor_id IS NOT NULL AND public.owns_vendor(auth.uid(), vendor_id));

-- updated_at triggers
CREATE TRIGGER trg_evt_voucher_templates_updated_at BEFORE UPDATE ON public.event_voucher_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_evt_vouchers_updated_at BEFORE UPDATE ON public.event_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Voucher code generator
CREATE OR REPLACE FUNCTION public.generate_voucher_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code TEXT; v_i INT; v_idx INT;
BEGIN
  v_code := 'FC-VCH-';
  FOR v_i IN 1..4 LOOP v_idx := 1 + floor(random() * length(v_alphabet))::int; v_code := v_code || substr(v_alphabet, v_idx, 1); END LOOP;
  v_code := v_code || '-';
  FOR v_i IN 1..4 LOOP v_idx := 1 + floor(random() * length(v_alphabet))::int; v_code := v_code || substr(v_alphabet, v_idx, 1); END LOOP;
  RETURN v_code;
END; $$;

-- Auto-generate vouchers on ticket creation
CREATE OR REPLACE FUNCTION public.generate_vouchers_for_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tpl RECORD; v_event RECORD; v_code TEXT; v_token TEXT; v_expires TIMESTAMPTZ; v_attempts INT;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  FOR v_tpl IN SELECT * FROM public.event_voucher_templates WHERE ticket_type_id = NEW.ticket_type_id AND is_active = true LOOP
    IF v_tpl.expires_at IS NOT NULL THEN
      v_expires := v_tpl.expires_at;
    ELSIF v_tpl.expires_hours_after_event IS NOT NULL AND v_event.event_date IS NOT NULL THEN
      v_expires := (v_event.event_date::timestamp + COALESCE(v_event.end_time, '23:59:00'::time)) + make_interval(hours => v_tpl.expires_hours_after_event);
    ELSE v_expires := NULL; END IF;

    v_attempts := 0;
    LOOP
      v_code := public.generate_voucher_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.event_vouchers WHERE voucher_code = v_code);
      v_attempts := v_attempts + 1;
      IF v_attempts > 10 THEN RAISE EXCEPTION 'Could not generate unique voucher code'; END IF;
    END LOOP;
    v_token := encode(gen_random_bytes(32), 'hex');

    INSERT INTO public.event_vouchers (voucher_code, qr_token, template_id, ticket_id, user_id, event_id, vendor_id, combo_id, reward_type, sponsor, sponsor_cost, expires_at)
    VALUES (v_code, v_token, v_tpl.id, NEW.id, NEW.user_id, NEW.event_id, v_tpl.vendor_id, v_tpl.combo_id, v_tpl.reward_type, v_tpl.sponsor, v_tpl.sponsor_cost_per_voucher, v_expires);
  END LOOP;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_generate_vouchers_on_ticket ON public.event_tickets;
CREATE TRIGGER trg_generate_vouchers_on_ticket AFTER INSERT ON public.event_tickets
  FOR EACH ROW EXECUTE FUNCTION public.generate_vouchers_for_ticket();

-- Venue redemption (vendor-scoped)
CREATE OR REPLACE FUNCTION public.redeem_voucher_at_venue(p_lookup TEXT, p_vendor_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_voucher public.event_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_voucher FROM public.event_vouchers WHERE qr_token = p_lookup OR voucher_code = upper(p_lookup) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 'INVALID', 'message', 'Voucher not found'); END IF;
  IF v_voucher.vendor_id IS NOT NULL AND v_voucher.vendor_id <> p_vendor_id THEN
    RETURN jsonb_build_object('ok', false, 'status', 'WRONG_VENDOR', 'message', 'Voucher belongs to another vendor'); END IF;
  IF v_voucher.status = 'redeemed' THEN
    RETURN jsonb_build_object('ok', false, 'status', 'ALREADY_REDEEMED', 'redeemed_at', v_voucher.redeemed_at); END IF;
  IF v_voucher.status IN ('expired', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'status', upper(v_voucher.status::text)); END IF;
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    UPDATE public.event_vouchers SET status = 'expired' WHERE id = v_voucher.id;
    RETURN jsonb_build_object('ok', false, 'status', 'EXPIRED'); END IF;

  UPDATE public.event_vouchers
  SET status = 'redeemed', redemption_method = 'venue', redeemed_at = now(),
      redeemed_vendor_id = p_vendor_id, redeemed_by = p_staff_id
  WHERE id = v_voucher.id;

  INSERT INTO public.voucher_settlements (voucher_id, event_id, vendor_id, sponsor, amount, redemption_method, notes)
  VALUES (v_voucher.id, v_voucher.event_id, p_vendor_id, v_voucher.sponsor, v_voucher.sponsor_cost, 'venue', 'Venue redemption');

  RETURN jsonb_build_object('ok', true, 'status', 'REDEEMED', 'voucher_code', v_voucher.voucher_code, 'reward_type', v_voucher.reward_type, 'combo_id', v_voucher.combo_id);
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_voucher_for_delivery(p_voucher_id UUID, p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_voucher public.event_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_voucher FROM public.event_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 'INVALID'); END IF;
  IF v_voucher.user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'status', 'FORBIDDEN'); END IF;
  IF v_voucher.status <> 'generated' THEN RETURN jsonb_build_object('ok', false, 'status', upper(v_voucher.status::text)); END IF;
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    UPDATE public.event_vouchers SET status = 'expired' WHERE id = v_voucher.id;
    RETURN jsonb_build_object('ok', false, 'status', 'EXPIRED'); END IF;
  UPDATE public.event_vouchers
  SET status = 'reserved', reserved_at = now(), reserved_order_id = p_order_id, redemption_method = 'delivery'
  WHERE id = v_voucher.id;
  RETURN jsonb_build_object('ok', true, 'status', 'RESERVED');
END; $$;

CREATE OR REPLACE FUNCTION public.release_voucher_reservation(p_voucher_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.event_vouchers
  SET status = 'generated', reserved_at = NULL, reserved_order_id = NULL, redemption_method = NULL
  WHERE id = p_voucher_id AND status = 'reserved';
END; $$;

CREATE OR REPLACE FUNCTION public.complete_voucher_delivery(p_voucher_id UUID, p_order_id UUID, p_vendor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_voucher public.event_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_voucher FROM public.event_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR v_voucher.status NOT IN ('reserved','generated') THEN RETURN; END IF;
  UPDATE public.event_vouchers
  SET status = 'redeemed', redemption_method = 'delivery', redeemed_at = now(),
      redeemed_vendor_id = p_vendor_id, redeemed_order_id = p_order_id
  WHERE id = p_voucher_id;
  INSERT INTO public.voucher_settlements (voucher_id, event_id, vendor_id, sponsor, amount, redemption_method, order_id, notes)
  VALUES (v_voucher.id, v_voucher.event_id, p_vendor_id, v_voucher.sponsor, v_voucher.sponsor_cost, 'delivery', p_order_id, 'Delivery redemption');
END; $$;
