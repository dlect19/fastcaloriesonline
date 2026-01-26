-- Add latitude/longitude to vendors table
ALTER TABLE public.vendors 
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric;

-- Insert default platform settings for location-based delivery
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('vendor_delivery_radius_km', '10', 'Maximum radius (km) for vendor to appear in customer search'),
  ('rider_search_radius_km', '5', 'Maximum radius (km) to search for available riders'),
  ('base_delivery_fee', '500', 'Base delivery fee in kobo for first X kilometers'),
  ('base_delivery_distance_km', '3', 'Distance covered by base delivery fee'),
  ('per_km_fee', '100', 'Additional fee per kilometer beyond base distance'),
  ('max_delivery_distance_km', '15', 'Maximum delivery distance allowed')
ON CONFLICT (key) DO NOTHING;

-- Create index for geospatial queries on vendors
CREATE INDEX IF NOT EXISTS idx_vendors_location ON public.vendors (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Create index for geospatial queries on riders
CREATE INDEX IF NOT EXISTS idx_rider_profiles_location ON public.rider_profiles (current_latitude, current_longitude) WHERE current_latitude IS NOT NULL AND current_longitude IS NOT NULL;

-- Create index for geospatial queries on addresses
CREATE INDEX IF NOT EXISTS idx_addresses_location ON public.addresses (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Enable realtime for rider_profiles to track rider location updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_profiles;