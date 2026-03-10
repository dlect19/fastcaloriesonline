
-- Add dispatch_radius_km to vehicle_type_configs
ALTER TABLE public.vehicle_type_configs 
ADD COLUMN IF NOT EXISTS dispatch_radius_km numeric DEFAULT NULL;

COMMENT ON COLUMN public.vehicle_type_configs.dispatch_radius_km IS 'Per-vehicle dispatch radius override. Falls back to global rider_search_radius_km if NULL.';

-- Create storage bucket for social media platform logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-logos', 'social-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read social logos (public)
CREATE POLICY "Public read social logos" ON storage.objects
FOR SELECT USING (bucket_id = 'social-logos');

-- Allow admin to upload social logos
CREATE POLICY "Admin upload social logos" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'social-logos' 
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Allow admin to update social logos
CREATE POLICY "Admin update social logos" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'social-logos'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Allow admin to delete social logos
CREATE POLICY "Admin delete social logos" ON storage.objects
FOR DELETE USING (
  bucket_id = 'social-logos'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
