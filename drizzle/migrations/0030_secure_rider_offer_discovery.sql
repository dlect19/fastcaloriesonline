-- Additive: secure rider offer discovery, authoritative rider capacity,
-- durable dispatch expiry/retry sweep, destination provenance columns.

ALTER TABLE public.dispatch_requests
  ADD COLUMN IF NOT EXISTS destination_source TEXT,
  ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC,
  ADD COLUMN IF NOT EXISTS retry_round INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS superseded_by_request_id UUID;

-- Single authoritative set of statuses that occupy a rider's capacity.
CREATE OR REPLACE FUNCTION public.rider_active_order_statuses()
RETURNS public.order_status[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY['assigned','picked_up','on_the_way']::public.order_status[];
$$;

CREATE OR REPLACE FUNCTION public.rider_active_order_count(_rider_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.orders o
  WHERE o.rider_id = _rider_user_id
    AND o.status = ANY (public.rider_active_order_statuses());
$$;

REVOKE ALL ON FUNCTION public.rider_active_order_statuses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rider_active_order_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rider_active_order_statuses() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rider_active_order_count(UUID) TO authenticated, service_role;

-- Secure discovery: returns ONLY the caller's own offers, joined server-side to
-- the private dispatch_requests/orders rows, with every eligibility gate applied
-- using server time. Never accepts a rider id from the client.
CREATE OR REPLACE FUNCTION public.get_my_rider_offers()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile public.rider_profiles;
  v_max_concurrent INTEGER;
  v_active INTEGER := 0;
  v_offers JSONB := '[]'::jsonb;
  v_excluded JSONB := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED',
      'offers', '[]'::jsonb, 'excluded', '[]'::jsonb, 'server_time', now());
  END IF;

  SELECT * INTO v_profile FROM public.rider_profiles WHERE user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_A_RIDER',
      'offers', '[]'::jsonb, 'excluded', '[]'::jsonb, 'server_time', now());
  END IF;

  SELECT COALESCE(NULLIF(value, ''), '1')::int INTO v_max_concurrent
  FROM public.platform_settings WHERE key = 'rider_max_concurrent_orders' LIMIT 1;
  v_max_concurrent := COALESCE(v_max_concurrent, 1);
  v_active := public.rider_active_order_count(v_uid);

  IF COALESCE(v_profile.is_online, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'RIDER_OFFLINE',
      'offers', '[]'::jsonb, 'excluded', '[]'::jsonb, 'server_time', now(),
      'active_order_count', v_active, 'max_concurrent_orders', v_max_concurrent);
  END IF;

  IF COALESCE(v_profile.is_verified, false) IS NOT TRUE
     OR COALESCE(v_profile.is_email_verified, false) IS NOT TRUE
     OR COALESCE(v_profile.nin_verified, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'RIDER_NOT_APPROVED',
      'offers', '[]'::jsonb, 'excluded', '[]'::jsonb, 'server_time', now(),
      'active_order_count', v_active, 'max_concurrent_orders', v_max_concurrent);
  END IF;

  IF v_active >= v_max_concurrent THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'RIDER_AT_CAPACITY',
      'offers', '[]'::jsonb, 'excluded', '[]'::jsonb, 'server_time', now(),
      'active_order_count', v_active, 'max_concurrent_orders', v_max_concurrent);
  END IF;

  WITH mine AS (
    SELECT o.*, dr.order_id, dr.status AS request_status, dr.vendor_id AS request_vendor_id,
           dr.outlet_id AS request_outlet_id, dr.vendor_latitude, dr.vendor_longitude,
           dr.customer_latitude, dr.customer_longitude,
           dr.delivery_distance_km AS request_distance_km,
           ord.order_number, ord.status AS order_status, ord.delivery_type,
           ord.payment_status, ord.channel, ord.payment_method, ord.rider_id AS order_rider_id,
           ord.duplicate_of_order_id, ord.delivery_address_text,
           ord.delivery_latitude, ord.delivery_longitude, ord.delivery_instructions
    FROM public.dispatch_offers o
    JOIN public.dispatch_requests dr ON dr.id = o.dispatch_request_id
    JOIN public.orders ord ON ord.id = dr.order_id
    WHERE o.rider_user_id = v_uid
      AND o.created_at > now() - INTERVAL '1 day'
  ), classified AS (
    SELECT m.*, CASE
      WHEN m.status IS DISTINCT FROM 'pending' THEN 'OFFER_NOT_PENDING'
      WHEN m.expires_at <= now() THEN 'OFFER_EXPIRED'
      WHEN COALESCE(m.request_status, 'pending') IS DISTINCT FROM 'pending' THEN 'REQUEST_NOT_ACTIVE'
      WHEN COALESCE(m.delivery_type, 'delivery') = 'self_pickup' THEN 'NOT_A_DELIVERY'
      WHEN m.order_status IN ('cancelled', 'delivered') THEN 'ORDER_CLOSED'
      WHEN m.duplicate_of_order_id IS NOT NULL THEN 'ORDER_SUPERSEDED'
      WHEN COALESCE(m.payment_status, 'pending') = 'refunded' THEN 'ORDER_REFUNDED'
      WHEN m.order_rider_id IS NOT NULL AND m.order_rider_id <> v_uid THEN 'ORDER_ASSIGNED_ELSEWHERE'
      WHEN NOT (
        COALESCE(m.payment_status, 'pending') = 'paid'
        OR COALESCE(m.channel, 'online') IN ('pos', 'assisted')
        OR COALESCE(m.payment_method, '') = 'cash'
      ) THEN 'ORDER_NOT_PAID'
      ELSE NULL
    END AS exclusion_reason
    FROM mine m
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'dispatch_request_id', c.dispatch_request_id,
      'rider_user_id', c.rider_user_id,
      'rider_profile_id', c.rider_profile_id,
      'order_id', c.order_id,
      'order_number', c.order_number,
      'distance_km', c.distance_km,
      'delivery_distance_km', c.request_distance_km,
      'delivery_fee', c.delivery_fee,
      'rider_share', c.rider_share,
      'priority_tier', c.priority_tier,
      'vendor_name', c.vendor_name,
      'vendor_address', c.vendor_address,
      'customer_address', COALESCE(c.customer_address, c.delivery_address_text),
      'delivery_instructions', c.delivery_instructions,
      'pickup_latitude', c.vendor_latitude,
      'pickup_longitude', c.vendor_longitude,
      'destination_latitude', COALESCE(c.delivery_latitude, c.customer_latitude),
      'destination_longitude', COALESCE(c.delivery_longitude, c.customer_longitude),
      'estimated_pickup_minutes', c.estimated_pickup_minutes,
      'estimated_delivery_minutes', c.estimated_delivery_minutes,
      'status', c.status,
      'created_at', c.created_at,
      'expires_at', c.expires_at,
      'responded_at', c.responded_at,
      'platform_fee', c.platform_fee,
      'distance_bonus', c.distance_bonus,
      'time_surge_bonus', c.time_surge_bonus,
      'weather_surge_bonus', c.weather_surge_bonus,
      'total_surge_bonus', c.total_surge_bonus,
      'subsidy_amount', c.subsidy_amount,
      'weather_condition', c.weather_condition,
      'time_period', c.time_period
    ) ORDER BY c.created_at DESC) FILTER (WHERE c.exclusion_reason IS NULL), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('offer_id', c.id, 'reason', c.exclusion_reason))
      FILTER (WHERE c.exclusion_reason IS NOT NULL), '[]'::jsonb)
  INTO v_offers, v_excluded
  FROM classified c;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', NULL,
    'offers', v_offers,
    'excluded', v_excluded,
    'server_time', now(),
    'active_order_count', v_active,
    'max_concurrent_orders', v_max_concurrent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_rider_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_rider_offers() TO authenticated, service_role;

-- Durable, idempotent expiry sweep. Marks history instead of deleting it and
-- returns the orders that are still genuinely eligible for another round.
CREATE OR REPLACE FUNCTION public.dispatch_sweep_expiry(p_limit INTEGER DEFAULT 25)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_offers INTEGER := 0;
  v_expired_requests INTEGER := 0;
  v_retry JSONB := '[]'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('dispatch_sweep_expiry')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'LOCK_HELD',
      'expired_offers', 0, 'expired_requests', 0, 'retry_candidates', '[]'::jsonb);
  END IF;

  WITH e AS (
    UPDATE public.dispatch_offers
    SET status = 'expired', responded_at = now()
    WHERE status = 'pending' AND expires_at <= now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_expired_offers FROM e;

  WITH r AS (
    UPDATE public.dispatch_requests dr
    SET status = CASE
      WHEN COALESCE(dr.retry_count, 0) >= COALESCE(dr.max_retries, 3) THEN 'failed'
      ELSE 'expired'
    END
    WHERE COALESCE(dr.status, 'pending') IN ('pending', 'no_riders')
      AND dr.expires_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_offers o
        WHERE o.dispatch_request_id = dr.id AND o.status IN ('pending', 'accepted')
      )
    RETURNING dr.id, dr.order_id, dr.retry_count, dr.max_retries, dr.search_radius_km
  )
  SELECT
    COUNT(*)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
      'dispatch_request_id', x.id,
      'order_id', x.order_id,
      'order_number', x.order_number,
      'retry_count', COALESCE(x.retry_count, 0),
      'max_retries', COALESCE(x.max_retries, 3),
      'search_radius_km', COALESCE(x.search_radius_km, 5)
    )) FILTER (WHERE x.eligible), '[]'::jsonb)
  INTO v_expired_requests, v_retry
  FROM (
    SELECT r.*, ord.order_number,
      (
        ord.rider_id IS NULL
        AND ord.status = 'searching_for_rider'
        AND COALESCE(ord.delivery_type, 'delivery') <> 'self_pickup'
        AND ord.duplicate_of_order_id IS NULL
        AND COALESCE(ord.payment_status, 'pending') <> 'refunded'
        AND (
          COALESCE(ord.payment_status, 'pending') = 'paid'
          OR COALESCE(ord.channel, 'online') IN ('pos', 'assisted')
          OR COALESCE(ord.payment_method, '') = 'cash'
        )
        AND COALESCE(r.retry_count, 0) < COALESCE(r.max_retries, 3)
      ) AS eligible
    FROM r
    JOIN public.orders ord ON ord.id = r.order_id
    LIMIT GREATEST(COALESCE(p_limit, 25), 1)
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'expired_offers', v_expired_offers,
    'expired_requests', v_expired_requests,
    'retry_candidates', v_retry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_sweep_expiry(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_sweep_expiry(INTEGER) TO service_role;
