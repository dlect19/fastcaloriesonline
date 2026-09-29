-- 0036: rider search recovery.
-- 1) dispatch_sweep_expiry only writes statuses allowed by dispatch_requests_status_check
--    ('expired' / 'no_riders', never 'failed'), and one bad row can no longer roll back
--    the whole sweep (per-row exception block).
-- 2) dispatch_prepare_round(order) decides, under a per-order lock, whether a genuinely
--    live round exists (return it untouched) or stale rounds must be retired (expired)
--    before a fresh round is inserted. Replaces the old supersede-first flow that wrote the
--    disallowed request status 'superseded' and orphaned pending rounds.

CREATE OR REPLACE FUNCTION public.dispatch_sweep_expiry(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expired_offers INTEGER := 0;
  v_expired_requests INTEGER := 0;
  v_retry JSONB := '[]'::jsonb;
  v_errors JSONB := '[]'::jsonb;
  v_limit INTEGER := GREATEST(COALESCE(p_limit, 25), 1);
  v_new_status TEXT;
  v_retry_count INTEGER := 0;
  rec RECORD;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('dispatch_sweep_expiry')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'LOCK_HELD',
      'expired_offers', 0, 'expired_requests', 0, 'retry_candidates', '[]'::jsonb, 'errors', '[]'::jsonb);
  END IF;

  WITH e AS (
    UPDATE public.dispatch_offers
    SET status = 'expired', responded_at = now()
    WHERE status = 'pending' AND expires_at <= now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_expired_offers FROM e;

  FOR rec IN
    SELECT dr.id, dr.order_id, COALESCE(dr.retry_count, 0) AS retry_count,
           COALESCE(dr.max_retries, 3) AS max_retries,
           COALESCE(dr.search_radius_km, 5) AS search_radius_km
    FROM public.dispatch_requests dr
    WHERE COALESCE(dr.status, 'pending') IN ('pending', 'no_riders')
      AND dr.expires_at <= now()
      -- already-exhausted no_riders rows are final; do not reprocess them every minute
      AND NOT (COALESCE(dr.status, 'pending') = 'no_riders'
               AND COALESCE(dr.retry_count, 0) >= COALESCE(dr.max_retries, 3))
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_offers o
        WHERE o.dispatch_request_id = dr.id AND o.status IN ('pending', 'accepted')
      )
    ORDER BY dr.expires_at
    LIMIT v_limit * 4
  LOOP
    BEGIN
      v_new_status := CASE WHEN rec.retry_count >= rec.max_retries THEN 'no_riders' ELSE 'expired' END;
      UPDATE public.dispatch_requests SET status = v_new_status WHERE id = rec.id;
      v_expired_requests := v_expired_requests + 1;

      IF v_new_status = 'expired' AND v_retry_count < v_limit AND EXISTS (
        SELECT 1 FROM public.orders ord
        WHERE ord.id = rec.order_id
          AND ord.rider_id IS NULL
          AND ord.status = 'searching_for_rider'
          AND COALESCE(ord.delivery_type, 'delivery') <> 'self_pickup'
          AND ord.duplicate_of_order_id IS NULL
          AND COALESCE(ord.payment_status, 'pending') <> 'refunded'
          AND (
            COALESCE(ord.payment_status, 'pending') = 'paid'
            OR COALESCE(ord.channel, 'online') IN ('pos', 'assisted')
            OR COALESCE(ord.payment_method, '') = 'cash'
          )
      ) THEN
        v_retry := v_retry || jsonb_build_object(
          'dispatch_request_id', rec.id,
          'order_id', rec.order_id,
          'order_number', (SELECT order_number FROM public.orders WHERE id = rec.order_id),
          'retry_count', rec.retry_count,
          'max_retries', rec.max_retries,
          'search_radius_km', rec.search_radius_km
        );
        v_retry_count := v_retry_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('dispatch_request_id', rec.id, 'sqlstate', SQLSTATE);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'expired_offers', v_expired_offers,
    'expired_requests', v_expired_requests,
    'retry_candidates', v_retry,
    'errors', v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_prepare_round(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_live RECORD;
  v_retired uuid[];
  v_expired_offers INTEGER := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_ORDER');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dispatch_round:' || p_order_id::text));

  SELECT id, status, expires_at, search_radius_km, retry_round, created_at
    INTO v_live
  FROM public.dispatch_requests
  WHERE order_id = p_order_id AND status IN ('pending', 'accepted')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_live.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'accepted', 'dispatch_request_id', v_live.id);
  END IF;

  IF FOUND AND v_live.expires_at > now() AND EXISTS (
    SELECT 1 FROM public.dispatch_offers o
    WHERE o.dispatch_request_id = v_live.id AND o.status = 'pending' AND o.expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', true, 'action', 'live',
      'dispatch_request_id', v_live.id, 'status', v_live.status,
      'expires_at', v_live.expires_at, 'search_radius_km', v_live.search_radius_km,
      'retry_round', v_live.retry_round);
  END IF;

  -- Stale: retire every non-accepted round of this order (history kept, never deleted).
  WITH e AS (
    UPDATE public.dispatch_offers o
    SET status = 'expired', responded_at = now()
    WHERE o.status = 'pending'
      AND o.dispatch_request_id IN (
        SELECT id FROM public.dispatch_requests
        WHERE order_id = p_order_id AND status IN ('pending', 'no_riders'))
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_expired_offers FROM e;

  WITH r AS (
    UPDATE public.dispatch_requests
    SET status = 'expired'
    WHERE order_id = p_order_id AND status IN ('pending', 'no_riders')
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_retired FROM r;

  RETURN jsonb_build_object('ok', true, 'action', 'cleared',
    'retired_request_ids', to_jsonb(v_retired), 'expired_offers', v_expired_offers);
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_prepare_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_prepare_round(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.dispatch_sweep_expiry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_sweep_expiry(integer) TO service_role;
