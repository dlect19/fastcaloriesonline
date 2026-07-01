
-- Delivery distance cache to reduce Google Maps API calls
CREATE TABLE IF NOT EXISTS public.delivery_distance_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID,
  customer_address_id UUID,
  vendor_latitude DOUBLE PRECISION NOT NULL,
  vendor_longitude DOUBLE PRECISION NOT NULL,
  customer_latitude DOUBLE PRECISION NOT NULL,
  customer_longitude DOUBLE PRECISION NOT NULL,
  coord_key TEXT NOT NULL, -- rounded coord fingerprint for anonymous lookups
  google_place_id TEXT,
  distance_km NUMERIC(8,2) NOT NULL,
  duration_minutes INTEGER,
  delivery_fee NUMERIC(10,2),
  source TEXT NOT NULL DEFAULT 'google_maps',
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_distance_cache TO authenticated;
GRANT ALL ON public.delivery_distance_cache TO service_role;

ALTER TABLE public.delivery_distance_cache ENABLE ROW LEVEL SECURITY;

-- Read allowed to any authenticated user (cache is non-sensitive geo data)
CREATE POLICY "authenticated read cache"
  ON public.delivery_distance_cache FOR SELECT
  TO authenticated USING (true);

-- Writes restricted to service_role (edge functions)
CREATE POLICY "service_role manage cache"
  ON public.delivery_distance_cache FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ddc_vendor_address
  ON public.delivery_distance_cache (vendor_id, customer_address_id)
  WHERE vendor_id IS NOT NULL AND customer_address_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ddc_coord_key ON public.delivery_distance_cache (coord_key);
CREATE INDEX IF NOT EXISTS idx_ddc_expires ON public.delivery_distance_cache (expires_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_delivery_distance_cache()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ddc_touch ON public.delivery_distance_cache;
CREATE TRIGGER trg_ddc_touch BEFORE UPDATE ON public.delivery_distance_cache
FOR EACH ROW EXECUTE FUNCTION public.touch_delivery_distance_cache();

-- Auto-invalidate when address coords change
CREATE OR REPLACE FUNCTION public.invalidate_distance_cache_on_address()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
    DELETE FROM public.delivery_distance_cache WHERE customer_address_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_addresses_invalidate_cache ON public.addresses;
CREATE TRIGGER trg_addresses_invalidate_cache
AFTER UPDATE ON public.addresses
FOR EACH ROW EXECUTE FUNCTION public.invalidate_distance_cache_on_address();

-- Auto-invalidate when vendor coords change
CREATE OR REPLACE FUNCTION public.invalidate_distance_cache_on_vendor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
    DELETE FROM public.delivery_distance_cache WHERE vendor_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_vendors_invalidate_cache ON public.vendors;
CREATE TRIGGER trg_vendors_invalidate_cache
AFTER UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.invalidate_distance_cache_on_vendor();

-- Default admin setting for TTL
INSERT INTO public.platform_settings (key, value)
VALUES ('distance_cache_ttl_days', '30')
ON CONFLICT (key) DO NOTHING;

-- ============= WEATHER CACHE =============
CREATE TABLE IF NOT EXISTS public.weather_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key TEXT NOT NULL UNIQUE,
  area_name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  condition TEXT NOT NULL DEFAULT 'clear',
  temperature NUMERIC(5,2),
  rain_status TEXT,
  wind_speed NUMERIC(5,2),
  surge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'open-meteo',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.weather_cache TO authenticated, anon;
GRANT ALL ON public.weather_cache TO service_role;

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read weather cache"
  ON public.weather_cache FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "service_role manage weather cache"
  ON public.weather_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_weather_updated ON public.weather_cache (updated_at DESC);

-- API usage log for analytics
CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,             -- 'google_maps', 'open-meteo', ...
  endpoint TEXT NOT NULL,             -- 'distance_matrix', 'current_weather', ...
  outcome TEXT NOT NULL DEFAULT 'success', -- 'success' | 'cache_hit' | 'failed'
  cost_estimate_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_usage_log TO authenticated;
GRANT ALL ON public.api_usage_log TO service_role;

ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view usage log
CREATE POLICY "admins read api usage log"
  ON public.api_usage_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service_role manage api usage log"
  ON public.api_usage_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_api_usage_created ON public.api_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON public.api_usage_log (provider, created_at DESC);

-- Weather service defaults
INSERT INTO public.platform_settings (key, value) VALUES
  ('weather_service_enabled', 'true'),
  ('weather_service_provider', 'open-meteo'),
  ('weather_service_frequency_minutes', '15'),
  ('weather_service_business_hours_only', 'false'),
  ('weather_service_business_start_hour', '7'),
  ('weather_service_business_end_hour', '23'),
  ('weather_service_only_when_riders_online', 'true'),
  ('weather_service_only_when_active_orders', 'false')
ON CONFLICT (key) DO NOTHING;
