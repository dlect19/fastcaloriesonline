-- Create storage bucket for vendor assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-assets', 'vendor-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow vendors to upload their own assets
CREATE POLICY "Vendors can upload own assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vendor-assets' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow vendors to update their own assets
CREATE POLICY "Vendors can update own assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vendor-assets' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow vendors to delete their own assets
CREATE POLICY "Vendors can delete own assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vendor-assets' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow public access to view vendor assets
CREATE POLICY "Anyone can view vendor assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'vendor-assets');