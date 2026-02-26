
-- Create storage bucket for APK files
INSERT INTO storage.buckets (id, name, public) VALUES ('apk-files', 'apk-files', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "APK files are publicly downloadable"
ON storage.objects FOR SELECT
USING (bucket_id = 'apk-files');

-- Allow admin to upload APK files
CREATE POLICY "Admins can upload APK files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'apk-files'
  AND EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Allow admin to update/overwrite APK files
CREATE POLICY "Admins can update APK files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'apk-files'
  AND EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Allow admin to delete APK files
CREATE POLICY "Admins can delete APK files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'apk-files'
  AND EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);
