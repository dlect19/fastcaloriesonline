ALTER TABLE public.api_usage_log
  ADD COLUMN IF NOT EXISTS function_name text,
  ADD COLUMN IF NOT EXISTS api text,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS status_code integer,
  ADD COLUMN IF NOT EXISTS billable_elements integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS cache_status text,
  ADD COLUMN IF NOT EXISTS user_hash text,
  ADD COLUMN IF NOT EXISTS ip_hash text;
CREATE INDEX IF NOT EXISTS api_usage_log_provider_created_idx ON public.api_usage_log (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_log_fn_created_idx ON public.api_usage_log (function_name, created_at DESC);

ALTER TABLE public.delivery_distance_cache
  ADD COLUMN IF NOT EXISTS cache_key text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS provider_version text NOT NULL DEFAULT 'google_dm_v1';
CREATE UNIQUE INDEX IF NOT EXISTS delivery_distance_cache_cache_key_uidx ON public.delivery_distance_cache (cache_key);
COMMENT ON COLUMN public.delivery_distance_cache.coord_key IS 'DEPRECATED: replaced by cache_key (includes environment and provider version)';

-- Daily billable-element counter per environment/API (server cap)
CREATE TABLE IF NOT EXISTS public.google_api_daily_usage (
  day date NOT NULL,
  environment text NOT NULL,
  api text NOT NULL,
  elements integer NOT NULL DEFAULT 0,
  blocked integer NOT NULL DEFAULT 0,
  cap integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, environment, api)
);
GRANT SELECT ON public.google_api_daily_usage TO authenticated;
GRANT ALL ON public.google_api_daily_usage TO service_role;
ALTER TABLE public.google_api_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read google api daily usage" ON public.google_api_daily_usage
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Fixed-window rate buckets for public Google proxy endpoints
CREATE TABLE IF NOT EXISTS public.google_api_rate_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
GRANT ALL ON public.google_api_rate_buckets TO service_role;
ALTER TABLE public.google_api_rate_buckets ENABLE ROW LEVEL SECURITY;

-- Atomically reserve billable elements under the daily cap. Returns true if allowed.
CREATE OR REPLACE FUNCTION public.google_api_reserve(p_environment text, p_api text, p_elements integer, p_cap integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_elements <= 0 THEN RETURN true; END IF;
  INSERT INTO public.google_api_daily_usage(day, environment, api, elements, cap)
  VALUES ((now() AT TIME ZONE 'Africa/Lagos')::date, p_environment, p_api, 0, p_cap)
  ON CONFLICT (day, environment, api) DO NOTHING;

  UPDATE public.google_api_daily_usage
     SET elements = elements + p_elements, cap = p_cap, updated_at = now()
   WHERE day = (now() AT TIME ZONE 'Africa/Lagos')::date AND environment = p_environment AND api = p_api
     AND elements + p_elements <= p_cap
  RETURNING true INTO v_ok;

  IF v_ok IS NULL THEN
    UPDATE public.google_api_daily_usage SET blocked = blocked + 1, cap = p_cap, updated_at = now()
     WHERE day = (now() AT TIME ZONE 'Africa/Lagos')::date AND environment = p_environment AND api = p_api;
    RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.google_api_reserve(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_api_reserve(text, text, integer, integer) TO service_role;

-- Fixed-window rate limiter. Returns true when under the limit.
CREATE OR REPLACE FUNCTION public.google_api_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
DECLARE v_hits integer;
BEGIN
  INSERT INTO public.google_api_rate_buckets(bucket_key, window_start, hits) VALUES (p_key, v_start, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = google_api_rate_buckets.hits + 1
  RETURNING hits INTO v_hits;
  IF random() < 0.01 THEN
    DELETE FROM public.google_api_rate_buckets WHERE window_start < now() - interval '1 day';
  END IF;
  RETURN v_hits <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.google_api_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_api_rate_hit(text, integer, integer) TO service_role;