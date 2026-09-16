-- ============================================================================
-- Order integrity, delivery pricing and settlement safeguards (additive only)
-- ============================================================================

-- 1. Order-level integrity columns -------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_attempt_key text,
  ADD COLUMN IF NOT EXISTS delivery_quote_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_order_id uuid,
  ADD COLUMN IF NOT EXISTS integrity_note text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_attempt_key_uidx
  ON public.orders (checkout_attempt_key)
  WHERE checkout_attempt_key IS NOT NULL;

-- 2. Server-issued delivery quotes -------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  vendor_id uuid,
  outlet_id uuid,
  customer_address_id uuid,
  dest_lat numeric NOT NULL,
  dest_lng numeric NOT NULL,
  delivery_fee numeric NOT NULL,
  base_fee numeric NOT NULL DEFAULT 0,
  surge_fee numeric NOT NULL DEFAULT 0,
  distance_km numeric,
  source text,
  is_estimate boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_quotes TO authenticated;
GRANT ALL ON public.delivery_quotes TO service_role;
ALTER TABLE public.delivery_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read own delivery quotes" ON public.delivery_quotes;
CREATE POLICY "Customers read own delivery quotes"
  ON public.delivery_quotes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS delivery_quotes_user_created_idx
  ON public.delivery_quotes (user_id, created_at DESC);

-- 3. Diagnostics -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_integrity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid,
  vendor_id uuid,
  outlet_id uuid,
  order_id uuid,
  existing_order_id uuid,
  checkout_attempt_key text,
  delivery_quote_id uuid,
  submitted_fee numeric,
  expected_fee numeric,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.checkout_integrity_events TO authenticated;
GRANT ALL ON public.checkout_integrity_events TO service_role;
ALTER TABLE public.checkout_integrity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read checkout integrity events" ON public.checkout_integrity_events;
CREATE POLICY "Admins read checkout integrity events"
  ON public.checkout_integrity_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS checkout_integrity_events_created_idx
  ON public.checkout_integrity_events (created_at DESC);

CREATE OR REPLACE FUNCTION public.log_checkout_integrity_event(
  p_event_type text,
  p_user_id uuid DEFAULT NULL,
  p_vendor_id uuid DEFAULT NULL,
  p_outlet_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_existing_order_id uuid DEFAULT NULL,
  p_attempt_key text DEFAULT NULL,
  p_quote_id uuid DEFAULT NULL,
  p_submitted_fee numeric DEFAULT NULL,
  p_expected_fee numeric DEFAULT NULL,
  p_detail text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.checkout_integrity_events (
    event_type, user_id, vendor_id, outlet_id, order_id, existing_order_id,
    checkout_attempt_key, delivery_quote_id, submitted_fee, expected_fee, detail
  ) VALUES (
    p_event_type, p_user_id, p_vendor_id, p_outlet_id, p_order_id, p_existing_order_id,
    p_attempt_key, p_quote_id, p_submitted_fee, p_expected_fee, p_detail
  );
END;
$$;

-- 4. Checkout integrity gate (idempotency + authoritative delivery pricing) --
-- Applies to the customer app/web channel only, so POS, assisted and
-- WhatsApp ordering keep their existing server-side pricing paths untouched.
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

  -- 4a. Exactly one order per checkout attempt key.
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

  -- 4b. Short-window identical checkout guard (double tap / retry storm).
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

  -- 4c. Delivery pricing must come from a live server quote.
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

      -- Authoritative values win, always.
      NEW.delivery_fee := v_expected;
      NEW.delivery_distance_km := v_quote.distance_km;
      NEW.delivery_pricing_source := v_quote.source;

      UPDATE public.delivery_quotes SET consumed_order_id = NEW.id WHERE id = v_quote.id;
    END IF;
  ELSE
    -- Carryout carries no delivery pricing and no quote.
    NEW.delivery_quote_id := NULL;
    NEW.delivery_fee := 0;
    NEW.delivery_distance_km := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_checkout_integrity ON public.orders;
CREATE TRIGGER trg_enforce_checkout_integrity
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_checkout_integrity();

-- 5. Unpaid online orders can never be dispatched or completed --------------
CREATE OR REPLACE FUNCTION public.guard_unpaid_order_fulfilment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := COALESCE(NEW.channel, 'online');
BEGIN
  IF v_channel NOT IN ('online', 'whatsapp') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payment_method, 'wallet') = 'cash' THEN
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

DROP TRIGGER IF EXISTS trg_guard_unpaid_order_fulfilment ON public.orders;
CREATE TRIGGER trg_guard_unpaid_order_fulfilment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_unpaid_order_fulfilment();

-- 6. Notification suppression switch for maintenance/repair work ------------
-- Same behaviour as before, plus: (a) honours app.suppress_order_notifications,
-- (b) never posts with a fabricated service key.
CREATE OR REPLACE FUNCTION public.trigger_order_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url TEXT := 'https://bruyccrjymmpzulqhotw.supabase.co';
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
