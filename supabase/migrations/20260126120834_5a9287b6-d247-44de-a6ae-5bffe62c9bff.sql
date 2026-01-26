-- Add work location preference columns to rider_profiles
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_city TEXT;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_state TEXT;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_latitude NUMERIC;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_longitude NUMERIC;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS work_radius_km NUMERIC DEFAULT 10;