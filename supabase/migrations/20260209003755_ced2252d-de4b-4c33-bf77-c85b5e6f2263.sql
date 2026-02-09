
-- ============================================
-- Hybrid Rider Payout Model: Platform Settings
-- ============================================

-- Rider Payout Core Settings
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_platform_fee_pct', '20', 'Platform fee percentage of delivery fee for riders')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_platform_fee_min', '300', 'Minimum platform fee per delivery (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_platform_fee_max', '700', 'Maximum platform fee per delivery (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_minimum_payout', '900', 'Guaranteed minimum rider payout per delivery (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_distance_bonus_threshold_km', '4', 'Distance threshold before bonus kicks in (km)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_distance_bonus_rate', '100', 'Bonus per extra km beyond threshold (₦)')
ON CONFLICT (key) DO NOTHING;

-- Surge Settings
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_surge_enabled', 'true', 'Enable/disable all surge bonuses')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_time_surge_enabled', 'true', 'Enable/disable time-based surge')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_weather_surge_enabled', 'true', 'Enable/disable weather-based surge')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_max_surge_cap', '500', 'Maximum total surge bonus per order (₦)')
ON CONFLICT (key) DO NOTHING;

-- Time Period Definitions (hour values)
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_morning_start_hour', '6', 'Morning period start hour (24h)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_morning_end_hour', '12', 'Morning period end hour (24h, exclusive)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_afternoon_start_hour', '12', 'Afternoon period start hour (24h)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_afternoon_end_hour', '18', 'Afternoon period end hour (24h, exclusive)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_night_start_hour', '18', 'Night period start hour (24h)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_night_end_hour', '24', 'Night period end hour (24h, exclusive; wraps to 0)')
ON CONFLICT (key) DO NOTHING;

-- Time Surge Amounts
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_time_surge_morning', '0', 'Morning surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_time_surge_afternoon', '100', 'Afternoon surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_time_surge_night', '200', 'Night surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

-- Weather Surge Amounts
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_weather_surge_clear', '0', 'Clear weather surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_weather_surge_rain', '100', 'Light rain surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_weather_surge_storm', '300', 'Heavy rain/storm surge bonus (₦)')
ON CONFLICT (key) DO NOTHING;

-- Default weather override (admin can set this)
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('rider_weather_override', 'clear', 'Manual weather override: clear, rain, storm, or auto')
ON CONFLICT (key) DO NOTHING;


-- ============================================
-- Add payout breakdown columns to dispatch_offers
-- ============================================
ALTER TABLE public.dispatch_offers
  ADD COLUMN IF NOT EXISTS platform_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distance_bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_surge_bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weather_surge_bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_surge_bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subsidy_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weather_condition text DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS time_period text DEFAULT 'morning';


-- ============================================
-- Rider Payout Details table (audit trail per order)
-- ============================================
CREATE TABLE IF NOT EXISTS public.rider_payout_details (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  rider_user_id uuid NOT NULL,
  delivery_fee numeric NOT NULL DEFAULT 0,
  distance_km numeric NOT NULL DEFAULT 0,
  platform_fee numeric NOT NULL DEFAULT 0,
  distance_bonus numeric NOT NULL DEFAULT 0,
  time_surge_bonus numeric NOT NULL DEFAULT 0,
  weather_surge_bonus numeric NOT NULL DEFAULT 0,
  total_surge_bonus numeric NOT NULL DEFAULT 0,
  raw_rider_pay numeric NOT NULL DEFAULT 0,
  subsidy_amount numeric NOT NULL DEFAULT 0,
  final_rider_pay numeric NOT NULL DEFAULT 0,
  weather_condition text DEFAULT 'clear',
  time_period text DEFAULT 'morning',
  environment text DEFAULT 'production',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rider_payout_details ENABLE ROW LEVEL SECURITY;

-- Riders can see their own payout details
CREATE POLICY "Riders can view own payout details"
  ON public.rider_payout_details
  FOR SELECT
  USING (auth.uid() = rider_user_id);

-- Admin staff can view all payout details
CREATE POLICY "Admin can view all payout details"
  ON public.rider_payout_details
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_staff
      WHERE admin_staff.user_id = auth.uid()
      AND admin_staff.is_active = true
    )
  );

-- Service role can insert (from edge functions)
CREATE POLICY "Service role can insert payout details"
  ON public.rider_payout_details
  FOR INSERT
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rider_payout_details_order ON public.rider_payout_details(order_id);
CREATE INDEX IF NOT EXISTS idx_rider_payout_details_rider ON public.rider_payout_details(rider_user_id);
CREATE INDEX IF NOT EXISTS idx_rider_payout_details_created ON public.rider_payout_details(created_at);

-- Enable realtime for rider_payout_details (so riders can see updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_payout_details;
