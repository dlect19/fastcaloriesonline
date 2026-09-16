-- =====================================================================
-- P0/P1 hardening: order field security, server-authoritative checkout,
-- fingerprint idempotency, quote binding, atomic wallet payment,
-- stronger fulfilment gating, stale push URL fix.
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS checkout_fingerprint text;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_fingerprint
  ON public.orders (user_id, checkout_fingerprint, created_at DESC)
  WHERE checkout_fingerprint IS NOT NULL;

ALTER TABLE public.delivery_quotes ADD COLUMN IF NOT EXISTS checkout_fingerprint text;
ALTER TABLE public.delivery_quotes ADD COLUMN IF NOT EXISTS delivery_type text;

-- ---------------------------------------------------------------------
-- 1. Privileged context helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_privileged_order_context()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  -- Server-side (edge function / trigger / authoritative RPC) context.
  IF COALESCE(current_setting('app.authoritative_checkout', true), 'false') = 'true' THEN
    RETURN true;
  END IF;

  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role'),
    current_user
  );

  IF v_role IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN true;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Authoritative service fee (mirrors platform_settings config)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_service_fee(
  p_amount numeric,
  p_delivery_type text,
  p_category text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_suffix text;
  v_type text; v_fixed numeric; v_pct numeric; v_min numeric; v_max numeric;
  v_cat text := lower(COALESCE(p_category, 'food'));
  v_calc numeric;
  function_setting text;
BEGIN
  IF v_cat = 'pharmacy' THEN
    v_suffix := '_pharmacy'; v_type := 'hybrid'; v_fixed := 100; v_pct := 15; v_min := 100; v_max := 5000;
  ELSIF v_cat IN ('grocery', 'market', 'marketplace') THEN
    v_suffix := '_grocery'; v_type := 'hybrid'; v_fixed := 100; v_pct := 15; v_min := 100; v_max := 7500;
  ELSIF p_delivery_type = 'self_pickup' THEN
    v_suffix := '_pickup'; v_type := 'fixed'; v_fixed := 50; v_pct := 3; v_min := 50; v_max := 500;
  ELSE
    v_suffix := ''; v_type := 'fixed'; v_fixed := 100; v_pct := 5; v_min := 100; v_max := 1000;
  END IF;

  SELECT value INTO function_setting FROM public.platform_settings WHERE key = 'service_fee_type' || v_suffix;
  IF function_setting IS NOT NULL THEN v_type := function_setting; END IF;
  SELECT value INTO function_setting FROM public.platform_settings WHERE key = 'service_fee_fixed' || v_suffix;
  IF function_setting IS NOT NULL THEN v_fixed := function_setting::numeric; END IF;
  SELECT value INTO function_setting FROM public.platform_settings WHERE key = 'service_fee_percentage' || v_suffix;
  IF function_setting IS NOT NULL THEN v_pct := function_setting::numeric; END IF;
  SELECT value INTO function_setting FROM public.platform_settings WHERE key = 'service_fee_min' || v_suffix;
  IF function_setting IS NOT NULL THEN v_min := function_setting::numeric; END IF;
  SELECT value INTO function_setting FROM public.platform_settings WHERE key = 'service_fee_max' || v_suffix;
  IF function_setting IS NOT NULL THEN v_max := function_setting::numeric; END IF;

  IF v_type = 'fixed' THEN
    RETURN ROUND(v_fixed, 2);
  ELSIF v_type = 'percentage' THEN
    RETURN ROUND(COALESCE(p_amount, 0) * v_pct / 100);
  ELSE
    v_calc := COALESCE(p_amount, 0) * v_pct / 100;
    RETURN ROUND(LEAST(GREATEST(v_calc, v_min), v_max));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Maximum discount a checkout may carry (ceiling, never a hard reject)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.max_allowed_order_discount(
  p_user_id uuid,
  p_menu_subtotal numeric,
  p_promo_code text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_pct numeric := 0;
  v_fixed numeric := 0;
  v_setting text;
  v_code_discount numeric;
BEGIN
  FOR v_setting IN
    SELECT value FROM public.platform_settings
    WHERE key IN ('promo_first_order_percent', 'promo_loyalty_percent',
                  'pharmacy_welcome_percent', 'spin_max_discount_percent')
  LOOP
    BEGIN
      v_pct := GREATEST(v_pct, v_setting::numeric);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  SELECT value::numeric INTO v_fixed FROM public.platform_settings WHERE key = 'pharmacy_welcome_fixed';

  IF p_promo_code IS NOT NULL THEN
    SELECT CASE
             WHEN pc.discount_type = 'percentage' THEN COALESCE(p_menu_subtotal, 0) * pc.discount_value / 100
             ELSE pc.discount_value
           END
      INTO v_code_discount
    FROM public.promo_codes pc
    WHERE upper(pc.code) = upper(p_promo_code)
    LIMIT 1;
  END IF;

  RETURN GREATEST(
    ROUND(COALESCE(p_menu_subtotal, 0) * COALESCE(v_pct, 0) / 100, 2),
    COALESCE(v_fixed, 0),
    COALESCE(v_code_discount, 0)
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Protected-field guard on orders (browser tampering)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_protect_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean;
  v_is_vendor boolean;
  v_is_rider boolean;
  v_next text := NEW.status::text;
BEGIN
  IF public.is_privileged_order_context() THEN
    RETURN NEW;
  END IF;

  v_is_customer := v_uid IS NOT NULL AND v_uid = OLD.user_id;
  v_is_vendor   := v_uid IS NOT NULL AND public.owns_vendor(v_uid, OLD.vendor_id);
  v_is_rider    := v_uid IS NOT NULL AND (v_uid = OLD.rider_id OR public.has_role(v_uid, 'rider'));

  -- Financial / integrity fields are never writable from a client session.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.menu_subtotal IS DISTINCT FROM OLD.menu_subtotal
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.service_fee IS DISTINCT FROM OLD.service_fee
     OR NEW.packaging_fee IS DISTINCT FROM OLD.packaging_fee
     OR NEW.extra_package_fee IS DISTINCT FROM OLD.extra_package_fee
     OR NEW.discount IS DISTINCT FROM OLD.discount
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
     OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.checkout_attempt_key IS DISTINCT FROM OLD.checkout_attempt_key
     OR NEW.checkout_fingerprint IS DISTINCT FROM OLD.checkout_fingerprint
     OR NEW.delivery_quote_id IS DISTINCT FROM OLD.delivery_quote_id
     OR NEW.duplicate_of_order_id IS DISTINCT FROM OLD.duplicate_of_order_id
     OR NEW.integrity_note IS DISTINCT FROM OLD.integrity_note
     OR NEW.is_free_meal IS DISTINCT FROM OLD.is_free_meal
     OR NEW.free_meal_value IS DISTINCT FROM OLD.free_meal_value
     OR NEW.free_meal_promo_id IS DISTINCT FROM OLD.free_meal_promo_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
     OR NEW.delivery_latitude IS DISTINCT FROM OLD.delivery_latitude
     OR NEW.delivery_longitude IS DISTINCT FROM OLD.delivery_longitude
     OR NEW.delivery_distance_km IS DISTINCT FROM OLD.delivery_distance_km
     OR NEW.delivery_pricing_source IS DISTINCT FROM OLD.delivery_pricing_source
  THEN
    RAISE EXCEPTION 'ORDER_FIELD_PROTECTED: this field can only be changed by the platform'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Rider assignment: vendor/dispatcher assigns, or a rider claims a ready order.
  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    IF v_is_vendor THEN
      NULL;
    ELSIF v_is_rider AND OLD.rider_id IS NULL AND NEW.rider_id = v_uid
          AND OLD.status::text IN ('ready_for_pickup', 'searching_for_rider') THEN
      NULL;
    ELSIF v_is_rider AND OLD.rider_id = v_uid AND NEW.rider_id IS NULL THEN
      NULL; -- rider releases the job
    ELSE
      RAISE EXCEPTION 'ORDER_RIDER_ASSIGNMENT_DENIED: not allowed to change the rider on this order'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Status transitions: explicit per-actor allow-lists.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_is_vendor THEN
      IF v_next NOT IN ('confirmed', 'preparing', 'ready_for_pickup', 'searching_for_rider',
                        'assigned', 'delivered', 'cancelled') THEN
        RAISE EXCEPTION 'ORDER_STATUS_TRANSITION_DENIED: % is not a store transition', v_next
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF v_is_rider AND (OLD.rider_id = v_uid OR NEW.rider_id = v_uid) THEN
      IF v_next NOT IN ('assigned', 'picked_up', 'on_the_way', 'delivered', 'ready_for_pickup') THEN
        RAISE EXCEPTION 'ORDER_STATUS_TRANSITION_DENIED: % is not a rider transition', v_next
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF v_is_customer THEN
      IF v_next <> 'cancelled' THEN
        RAISE EXCEPTION 'ORDER_STATUS_TRANSITION_DENIED: customers may only cancel'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      RAISE EXCEPTION 'ORDER_STATUS_TRANSITION_DENIED: not allowed to change this order'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_protect_fields ON public.orders;
CREATE TRIGGER trg_orders_protect_fields
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_protect_fields();

-- ---------------------------------------------------------------------
-- 5. Only the authoritative server path may create customer orders
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_authoritative_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := COALESCE(NEW.channel, 'online');
  v_enforce boolean;
BEGIN
  IF public.is_privileged_order_context() THEN
    RETURN NEW;
  END IF;

  IF v_channel = 'pos' THEN
    IF auth.uid() IS NOT NULL AND public.owns_vendor(auth.uid(), NEW.vendor_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'POS_ORDER_DENIED: only store staff may record a POS sale'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE((SELECT value FROM public.platform_settings WHERE key = 'enforce_server_checkout'), 'false') = 'true'
    INTO v_enforce;

  IF v_enforce THEN
    PERFORM public.log_checkout_integrity_event(
      'client_order_insert_blocked', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
      NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id, NEW.delivery_fee, NULL,
      'Direct browser order insert rejected — checkout must use create_customer_order');
    RAISE EXCEPTION 'CLIENT_CHECKOUT_DISABLED: place this order through the secure checkout'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_authoritative_insert ON public.orders;
CREATE TRIGGER trg_orders_authoritative_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_authoritative_insert();

INSERT INTO public.platform_settings (key, value, description)
VALUES ('enforce_server_checkout', 'false', 'When true, customer orders may only be created through create_customer_order')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Fingerprint-aware duplicate guard + quote checkout binding
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_checkout_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := COALESCE(NEW.channel, 'online');
  v_existing uuid;
  v_quote public.delivery_quotes;
  v_expected numeric;
  v_enforce boolean;
BEGIN
  IF v_channel <> 'online' THEN
    RETURN NEW;
  END IF;

  -- Exactly one order per checkout attempt key.
  IF NEW.checkout_attempt_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.orders
    WHERE checkout_attempt_key = NEW.checkout_attempt_key
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      PERFORM public.log_checkout_integrity_event(
        'duplicate_attempt_key', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
        NULL, v_existing, NEW.checkout_attempt_key, NEW.delivery_quote_id,
        NEW.delivery_fee, NULL, 'Replayed checkout attempt key');
      RAISE EXCEPTION 'DUPLICATE_CHECKOUT:%', v_existing USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Exactly one live order per checkout fingerprint (same cart/address/fulfilment).
  -- A fingerprint whose order is already paid is a completed checkout, so a
  -- deliberate identical reorder is allowed.
  IF NEW.checkout_fingerprint IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.orders
    WHERE user_id = NEW.user_id
      AND checkout_fingerprint = NEW.checkout_fingerprint
      AND status <> 'cancelled'
      AND payment_status <> 'paid'
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      PERFORM public.log_checkout_integrity_event(
        'duplicate_fingerprint', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
        NULL, v_existing, NEW.checkout_attempt_key, NEW.delivery_quote_id,
        NEW.delivery_fee, NULL, 'Unpaid order already exists for this checkout fingerprint');
      RAISE EXCEPTION 'DUPLICATE_CHECKOUT:%', v_existing USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    -- Legacy clients without a fingerprint keep the short-window heuristic.
    SELECT id INTO v_existing FROM public.orders
    WHERE user_id = NEW.user_id
      AND vendor_id = NEW.vendor_id
      AND COALESCE(outlet_id::text, '') = COALESCE(NEW.outlet_id::text, '')
      AND delivery_type = NEW.delivery_type
      AND total = NEW.total
      AND COALESCE(channel, 'online') = 'online'
      AND status <> 'cancelled'
      AND created_at > now() - interval '120 seconds'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      PERFORM public.log_checkout_integrity_event(
        'short_window_duplicate', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
        NULL, v_existing, NEW.checkout_attempt_key, NEW.delivery_quote_id,
        NEW.delivery_fee, NULL, 'Identical checkout within 120s');
      RAISE EXCEPTION 'DUPLICATE_CHECKOUT:%', v_existing USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  IF NEW.delivery_type = 'delivery' THEN
    SELECT COALESCE((SELECT value FROM public.platform_settings WHERE key = 'enforce_delivery_quote'), 'true') = 'true'
      INTO v_enforce;

    IF v_enforce THEN
      IF NEW.delivery_quote_id IS NULL THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_quote_missing', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NULL, NEW.delivery_fee, NULL,
          'Delivery order submitted without a server quote');
        RAISE EXCEPTION 'DELIVERY_QUOTE_REQUIRED';
      END IF;

      SELECT * INTO v_quote FROM public.delivery_quotes
      WHERE id = NEW.delivery_quote_id
        AND user_id = NEW.user_id
        AND vendor_id = NEW.vendor_id
        AND consumed_order_id IS NULL
        AND expires_at > now();

      IF v_quote.id IS NULL THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_quote_invalid', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id, NEW.delivery_fee, NULL,
          'Quote missing, expired, already used or bound to another customer/store');
        RAISE EXCEPTION 'DELIVERY_QUOTE_STALE';
      END IF;

      IF v_quote.outlet_id IS NOT NULL AND NEW.outlet_id IS NOT NULL
         AND v_quote.outlet_id <> NEW.outlet_id THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_quote_outlet_mismatch', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id, NEW.delivery_fee, NULL,
          'Quote was issued for a different branch');
        RAISE EXCEPTION 'DELIVERY_QUOTE_OUTLET_MISMATCH';
      END IF;

      -- Quote is bound to the checkout context when the client supplied one.
      IF v_quote.checkout_fingerprint IS NOT NULL
         AND NEW.checkout_fingerprint IS NOT NULL
         AND v_quote.checkout_fingerprint <> NEW.checkout_fingerprint THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_quote_checkout_mismatch', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id, NEW.delivery_fee, NULL,
          'Quote was issued for a different cart/checkout context');
        RAISE EXCEPTION 'DELIVERY_QUOTE_CHECKOUT_MISMATCH';
      END IF;

      IF v_quote.delivery_type IS NOT NULL AND v_quote.delivery_type <> 'delivery' THEN
        RAISE EXCEPTION 'DELIVERY_QUOTE_STALE';
      END IF;

      IF NEW.delivery_latitude IS NULL OR NEW.delivery_longitude IS NULL
         OR abs(NEW.delivery_latitude - v_quote.dest_lat) > 0.0015
         OR abs(NEW.delivery_longitude - v_quote.dest_lng) > 0.0015 THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_quote_location_mismatch', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id, NEW.delivery_fee, NULL,
          'Delivery coordinates differ from the quoted destination');
        RAISE EXCEPTION 'DELIVERY_QUOTE_LOCATION_MISMATCH';
      END IF;

      v_expected := v_quote.delivery_fee + COALESCE(NEW.extra_package_fee, 0);

      IF NEW.delivery_fee IS NULL OR abs(NEW.delivery_fee - v_expected) > 0.5 THEN
        PERFORM public.log_checkout_integrity_event(
          'delivery_fee_mismatch', NEW.user_id, NEW.vendor_id, NEW.outlet_id,
          NULL, NULL, NEW.checkout_attempt_key, NEW.delivery_quote_id,
          NEW.delivery_fee, v_expected, 'Submitted delivery fee differs from the server quote');
        RAISE EXCEPTION 'DELIVERY_FEE_MISMATCH';
      END IF;

      NEW.delivery_fee := v_expected;
      NEW.delivery_distance_km := v_quote.distance_km;
      NEW.delivery_pricing_source := v_quote.source;

      UPDATE public.delivery_quotes SET consumed_order_id = NEW.id WHERE id = v_quote.id;
    END IF;
  ELSE
    NEW.delivery_quote_id := NULL;
    NEW.delivery_fee := 0;
    NEW.delivery_distance_km := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Unpaid fulfilment guard — no cash bypass on online/whatsapp orders
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_unpaid_order_fulfilment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := COALESCE(NEW.channel, 'online');
BEGIN
  -- POS and assisted (server-authorised, cash at counter) are a different model.
  IF v_channel NOT IN ('online', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status = 'paid' THEN
    RETURN NEW;
  END IF;

  IF NEW.rider_id IS NOT NULL AND OLD.rider_id IS DISTINCT FROM NEW.rider_id THEN
    RAISE EXCEPTION 'UNPAID_ORDER_CANNOT_DISPATCH: order % has not been paid for', NEW.order_number;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IN ('confirmed','preparing','ready_for_pickup','searching_for_rider',
                              'assigned','picked_up','on_the_way','delivered') THEN
    RAISE EXCEPTION 'UNPAID_ORDER_CANNOT_FULFIL: order % has not been paid for', NEW.order_number;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. RLS: least privilege with WITH CHECK
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Involved parties can update orders" ON public.orders;
CREATE POLICY "Involved parties can update orders"
ON public.orders FOR UPDATE
USING (auth.uid() = user_id OR public.owns_vendor(auth.uid(), vendor_id) OR auth.uid() = rider_id)
WITH CHECK (auth.uid() = user_id OR public.owns_vendor(auth.uid(), vendor_id) OR auth.uid() = rider_id);

DROP POLICY IF EXISTS "Riders can claim unassigned orders" ON public.orders;
CREATE POLICY "Riders can claim unassigned orders"
ON public.orders FOR UPDATE
USING (status = 'ready_for_pickup'::order_status AND rider_id IS NULL AND public.has_role(auth.uid(), 'rider'))
WITH CHECK (public.has_role(auth.uid(), 'rider') AND rider_id = auth.uid());

-- ---------------------------------------------------------------------
-- 9. Push notification trigger — current project, never blocking
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_order_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_payload JSONB;
BEGIN
  IF COALESCE(current_setting('app.suppress_order_notifications', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NOT (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
          OR OLD.rider_id IS DISTINCT FROM NEW.rider_id) THEN
    RETURN NEW;
  END IF;

  v_service_key := current_setting('supabase.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_supabase_url FROM public.platform_settings WHERE key = 'functions_base_url';
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'order_id', NEW.id,
    'old_status', OLD.status,
    'new_status', NEW.status,
    'old_payment_status', OLD.payment_status,
    'new_payment_status', NEW.payment_status,
    'old_rider_id', OLD.rider_id,
    'new_rider_id', NEW.rider_id
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/notify-order-update',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_service_key),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

INSERT INTO public.platform_settings (key, value, description)
VALUES ('functions_base_url', 'https://yrfbvuiinvytlvouzyxv.supabase.co', 'Base URL used by database triggers to reach edge functions')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;