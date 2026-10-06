-- Latest-only live rider location per active delivery order (no trail).
CREATE TABLE public.rider_live_locations (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  rider_user_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m real,
  heading real,
  speed_mps real,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  session_started_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL DEFAULT 'production'
);
GRANT SELECT ON public.rider_live_locations TO authenticated;
GRANT ALL ON public.rider_live_locations TO service_role;
ALTER TABLE public.rider_live_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customer reads own active order rider location"
ON public.rider_live_locations FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.id = rider_live_locations.order_id
    AND o.user_id = auth.uid()
    AND o.rider_id = rider_live_locations.rider_user_id
    AND o.delivery_type = 'delivery'
    AND o.status IN ('assigned','picked_up','on_the_way')
));
CREATE POLICY "Rider reads own live location"
ON public.rider_live_locations FOR SELECT TO authenticated
USING (rider_user_id = auth.uid());
CREATE POLICY "Admins read live locations"
ON public.rider_live_locations FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.rider_live_locations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_live_locations;

-- Aggregate counters only — never coordinates.
CREATE TABLE public.rider_tracking_daily_metrics (
  day date NOT NULL,
  environment text NOT NULL,
  accepted integer NOT NULL DEFAULT 0,
  rejected_rate_limited integer NOT NULL DEFAULT 0,
  rejected_invalid integer NOT NULL DEFAULT 0,
  rejected_implausible integer NOT NULL DEFAULT 0,
  rejected_unauthorized integer NOT NULL DEFAULT 0,
  rejected_disabled integer NOT NULL DEFAULT 0,
  rejected_daily_cap integer NOT NULL DEFAULT 0,
  rejected_not_active integer NOT NULL DEFAULT 0,
  sessions_started integer NOT NULL DEFAULT 0,
  route_refreshes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, environment)
);
GRANT SELECT ON public.rider_tracking_daily_metrics TO authenticated;
GRANT ALL ON public.rider_tracking_daily_metrics TO service_role;
ALTER TABLE public.rider_tracking_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read tracking metrics"
ON public.rider_tracking_daily_metrics FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.rider_tracking_setting(p_key text, p_default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value FROM public.platform_settings WHERE key = p_key LIMIT 1), p_default)
$$;

CREATE OR REPLACE FUNCTION public.rider_tracking_bump(p_env text, p_col text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_col NOT IN ('accepted','rejected_rate_limited','rejected_invalid','rejected_implausible',
    'rejected_unauthorized','rejected_disabled','rejected_daily_cap','rejected_not_active',
    'sessions_started','route_refreshes') THEN
    RETURN;
  END IF;
  EXECUTE format(
    'INSERT INTO public.rider_tracking_daily_metrics (day, environment, %1$I) VALUES ((now() AT TIME ZONE ''Africa/Lagos'')::date, $1, 1)
     ON CONFLICT (day, environment) DO UPDATE SET %1$I = public.rider_tracking_daily_metrics.%1$I + 1', p_col)
  USING p_env;
END $$;
REVOKE ALL ON FUNCTION public.rider_tracking_bump(text, text) FROM PUBLIC, anon, authenticated;

-- The only write path. Rider/order relationship is derived server-side.
CREATE OR REPLACE FUNCTION public.publish_rider_location(
  p_order_id uuid, p_lat double precision, p_lng double precision,
  p_accuracy real DEFAULT NULL, p_heading real DEFAULT NULL, p_speed real DEFAULT NULL,
  p_captured_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env text := COALESCE(public.get_platform_environment(), 'production');
  v_now timestamptz := now();
  v_o record;
  v_prev public.rider_live_locations%ROWTYPE;
  v_min_int int := GREATEST(1, COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_min_server_interval_s','5'),'')::int, 5));
  v_cap int := COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_daily_cap','100000'),'')::int, 100000);
  v_accepted int;
  v_dist double precision;
  v_dt double precision;
  v_new_session boolean;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_unauthorized');
    RETURN jsonb_build_object('ok', false, 'reason', 'auth_required', 'stop', true);
  END IF;
  IF public.rider_tracking_setting('rider_tracking_enabled', 'true') = 'false' THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_disabled');
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled', 'stop', true);
  END IF;

  SELECT id, rider_id, status, delivery_type INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_o.rider_id IS DISTINCT FROM v_uid OR v_o.delivery_type <> 'delivery' THEN
    PERFORM public.rider_tracking_bump(v_env, 'rejected_unauthorized');
    RETURN jsonb_build_object('ok', false, 'reason', 'not_assigned', 'stop', true);
  END IF;
  IF v_o.status NOT IN ('assigned','picked_up','on_the_way') THEN
    DELETE FROM public.rider_live_locations WHERE order_id = p_order_id;
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

  SELECT * INTO v_prev FROM public.rider_live_locations WHERE order_id = p_order_id FOR UPDATE;
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
  VALUES (p_order_id, v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, p_captured_at, v_now, v_now, v_env)
  ON CONFLICT (order_id) DO UPDATE SET
    rider_user_id = EXCLUDED.rider_user_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    accuracy_m = EXCLUDED.accuracy_m, heading = EXCLUDED.heading, speed_mps = EXCLUDED.speed_mps,
    captured_at = EXCLUDED.captured_at, received_at = EXCLUDED.received_at,
    session_started_at = CASE WHEN r.rider_user_id = EXCLUDED.rider_user_id THEN r.session_started_at ELSE EXCLUDED.session_started_at END,
    environment = EXCLUDED.environment;

  IF v_new_session THEN PERFORM public.rider_tracking_bump(v_env, 'sessions_started'); END IF;
  PERFORM public.rider_tracking_bump(v_env, 'accepted');
  RETURN jsonb_build_object('ok', true, 'min_interval_s', v_min_int);
END $$;
REVOKE ALL ON FUNCTION public.publish_rider_location(uuid, double precision, double precision, real, real, real, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_rider_location(uuid, double precision, double precision, real, real, real, timestamptz) TO authenticated;

-- Stop tracking the moment the order leaves an active delivery state or the rider changes.
CREATE OR REPLACE FUNCTION public.stop_rider_live_location_on_order_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('assigned','picked_up','on_the_way')
     OR NEW.rider_id IS DISTINCT FROM OLD.rider_id
     OR NEW.delivery_type <> 'delivery' THEN
    DELETE FROM public.rider_live_locations WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stop_rider_live_location
AFTER UPDATE OF status, rider_id, delivery_type ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stop_rider_live_location_on_order_change();

-- Retention backstop: latest rows older than the retention window, or for orders
-- no longer active, are removed; aggregate metrics kept 90 days.
CREATE OR REPLACE FUNCTION public.cleanup_rider_live_locations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hours int := LEAST(72, GREATEST(1, COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_retention_hours','24'),'')::int, 24)));
  v_n int;
BEGIN
  DELETE FROM public.rider_live_locations l
   WHERE l.received_at < now() - make_interval(hours => v_hours)
      OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = l.order_id
                      AND o.rider_id = l.rider_user_id AND o.status IN ('assigned','picked_up','on_the_way'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.rider_tracking_daily_metrics WHERE day < (now() - interval '90 days')::date;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_rider_live_locations() FROM PUBLIC, anon, authenticated;

-- Admin status: counts only.
CREATE OR REPLACE FUNCTION public.admin_rider_tracking_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_env text := COALESCE(public.get_platform_environment(), 'production');
  v_stale int := COALESCE(NULLIF(public.rider_tracking_setting('rider_tracking_stale_after_s','90'),'')::int, 90);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN jsonb_build_object(
    'environment', v_env,
    'active_sessions', (SELECT count(*) FROM public.rider_live_locations WHERE environment = v_env AND received_at >= now() - make_interval(secs => v_stale)),
    'stale_sessions', (SELECT count(*) FROM public.rider_live_locations WHERE environment = v_env AND received_at < now() - make_interval(secs => v_stale)),
    'today', (SELECT to_jsonb(m) - 'environment' FROM public.rider_tracking_daily_metrics m
              WHERE m.environment = v_env AND m.day = (now() AT TIME ZONE 'Africa/Lagos')::date)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_rider_tracking_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rider_tracking_status() TO authenticated;
