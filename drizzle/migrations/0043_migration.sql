-- Native background rider tracking: per-delivery upload tokens (hash only stored) and a
-- token-authenticated ingestion RPC with the same validation as publish_rider_location.
-- Additive: publish_rider_location (JS path) is unchanged.
CREATE TABLE public.rider_tracking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  rider_user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);
GRANT ALL ON public.rider_tracking_tokens TO service_role;
ALTER TABLE public.rider_tracking_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read rider tracking tokens" ON public.rider_tracking_tokens
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX rider_tracking_tokens_rider_order_idx ON public.rider_tracking_tokens (rider_user_id, order_id);

-- Issue a fresh token for the caller's own active delivery (revokes older ones for that order).
CREATE OR REPLACE FUNCTION public.issue_rider_tracking_token(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env text := COALESCE(public.get_platform_environment(), 'production');
  v_o record; v_token text; v_exp timestamptz := now() + interval '4 hours';
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth_required'); END IF;
  IF public.rider_tracking_setting('rider_tracking_enabled', 'true') = 'false' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  SELECT id, rider_id, status, delivery_type INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_o.rider_id IS DISTINCT FROM v_uid OR v_o.delivery_type <> 'delivery'
     OR v_o.status NOT IN ('assigned','picked_up','on_the_way') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_assigned');
  END IF;
  UPDATE public.rider_tracking_tokens SET revoked_at = now()
   WHERE rider_user_id = v_uid AND order_id = p_order_id AND revoked_at IS NULL;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.rider_tracking_tokens (token_hash, rider_user_id, order_id, environment, expires_at)
  VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid, p_order_id, v_env, v_exp);
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp);
END $$;
REVOKE ALL ON FUNCTION public.issue_rider_tracking_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_rider_tracking_token(uuid) TO authenticated;

-- Revoke all of the caller's tokens (logout / tracking stop while signed in).
CREATE OR REPLACE FUNCTION public.revoke_my_rider_tracking_tokens()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH u AS (UPDATE public.rider_tracking_tokens SET revoked_at = now()
             WHERE rider_user_id = auth.uid() AND revoked_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM u;
$$;
REVOKE ALL ON FUNCTION public.revoke_my_rider_tracking_tokens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_rider_tracking_tokens() TO authenticated;

-- Token-authenticated ingestion used by the native foreground service (JS may be suspended).
-- Same validation, ownership, out-of-order, plausibility, daily cap and stop semantics as
-- publish_rider_location; only the per-order min interval uses its own setting (default 1 s).
CREATE OR REPLACE FUNCTION public.publish_rider_location_native(
  p_token text, p_lat double precision, p_lng double precision, p_accuracy real DEFAULT NULL,
  p_heading real DEFAULT NULL, p_speed real DEFAULT NULL, p_captured_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_env text := COALESCE(public.get_platform_environment(), 'production');
  v_now timestamptz := now();
  v_t public.rider_tracking_tokens%ROWTYPE;
  v_uid uuid; v_order uuid; v_o record;
  v_prev public.rider_live_locations%ROWTYPE;
  v_min_int int := GREATEST(1, COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_native_min_interval_s','1'),'')::int, 1));
  v_cap int := COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_daily_cap','100000'),'')::int, 100000);
  v_accepted int; v_dist double precision; v_dt double precision; v_new_session boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_unauthorized');
    RETURN jsonb_build_object('ok', false, 'reason', 'auth_required', 'stop', true);
  END IF;
  SELECT * INTO v_t FROM public.rider_tracking_tokens WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND OR v_t.revoked_at IS NOT NULL OR v_t.expires_at < v_now OR v_t.environment <> v_env THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_unauthorized');
    RETURN jsonb_build_object('ok', false, 'reason', 'token_invalid', 'stop', true);
  END IF;
  v_uid := v_t.rider_user_id; v_order := v_t.order_id;
  IF public.rider_tracking_setting('rider_tracking_enabled', 'true') = 'false' THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_disabled');
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled', 'stop', true);
  END IF;
  SELECT id, rider_id, status, delivery_type INTO v_o FROM public.orders WHERE id = v_order;
  IF NOT FOUND OR v_o.rider_id IS DISTINCT FROM v_uid OR v_o.delivery_type <> 'delivery' THEN
    UPDATE public.rider_tracking_tokens SET revoked_at = v_now WHERE id = v_t.id;
    PERFORM public.rider_tracking_bump(v_env, 'rejected_unauthorized');
    RETURN jsonb_build_object('ok', false, 'reason', 'not_assigned', 'stop', true);
  END IF;
  IF v_o.status NOT IN ('assigned','picked_up','on_the_way') THEN
    UPDATE public.rider_tracking_tokens SET revoked_at = v_now WHERE id = v_t.id;
    DELETE FROM public.rider_live_locations WHERE order_id = v_order;
    PERFORM public.rider_tracking_bump(v_env, 'rejected_not_active');
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active', 'stop', true);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR (abs(p_lat) < 0.0001 AND abs(p_lng) < 0.0001)
     OR (p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 1000))
     OR (p_speed IS NOT NULL AND (p_speed < 0 OR p_speed > 70))
     OR p_captured_at IS NULL OR p_captured_at > v_now + interval '30 seconds'
     OR p_captured_at < v_now - interval '2 minutes' THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_invalid');
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  SELECT * INTO v_prev FROM public.rider_live_locations WHERE order_id = v_order FOR UPDATE;
  v_new_session := NOT FOUND OR v_prev.rider_user_id <> v_uid;
  IF NOT v_new_session THEN
    IF v_prev.received_at > v_now - make_interval(secs => v_min_int) THEN
      PERFORM public.rider_tracking_bump(v_env, 'rejected_rate_limited');
      RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited', 'retry_after_s', v_min_int);
    END IF;
    v_dt := EXTRACT(EPOCH FROM (p_captured_at - v_prev.captured_at));
    IF v_dt <= 0 THEN
      PERFORM public.rider_tracking_bump(v_env, 'rejected_invalid');
      RETURN jsonb_build_object('ok', false, 'reason', 'out_of_order');
    END IF;
    v_dist := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_prev.lat) / 2), 2) +
      cos(radians(v_prev.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_prev.lng) / 2), 2)));
    IF v_dist > 300 AND v_dist / v_dt > 70 THEN
      PERFORM public.rider_tracking_bump(v_env, 'rejected_implausible');
      RETURN jsonb_build_object('ok', false, 'reason', 'implausible');
    END IF;
  END IF;
  SELECT accepted INTO v_accepted FROM public.rider_tracking_daily_metrics
   WHERE day = (v_now AT TIME ZONE 'Africa/Lagos')::date AND environment = v_env;
  IF COALESCE(v_accepted, 0) >= v_cap THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_daily_cap');
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap', 'stop', true);
  END IF;
  INSERT INTO public.rider_live_locations AS r
    (order_id, rider_user_id, lat, lng, accuracy_m, heading, speed_mps, captured_at, received_at, session_started_at, environment)
  VALUES (v_order, v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, p_captured_at, v_now, v_now, v_env)
  ON CONFLICT (order_id) DO UPDATE SET
    rider_user_id = EXCLUDED.rider_user_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    accuracy_m = EXCLUDED.accuracy_m, heading = EXCLUDED.heading, speed_mps = EXCLUDED.speed_mps,
    captured_at = EXCLUDED.captured_at, received_at = EXCLUDED.received_at,
    session_started_at = CASE WHEN r.rider_user_id = EXCLUDED.rider_user_id THEN r.session_started_at ELSE EXCLUDED.session_started_at END,
    environment = EXCLUDED.environment;
  UPDATE public.rider_tracking_tokens SET last_used_at = v_now WHERE id = v_t.id;
  IF v_new_session THEN PERFORM public.rider_tracking_bump(v_env, 'sessions_started'); END IF;
  PERFORM public.rider_tracking_bump(v_env, 'accepted');
  RETURN jsonb_build_object('ok', true, 'min_interval_s', v_min_int);
END $$;
REVOKE ALL ON FUNCTION public.publish_rider_location_native(text, double precision, double precision, real, real, real, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_rider_location_native(text, double precision, double precision, real, real, real, timestamptz) TO anon, authenticated;