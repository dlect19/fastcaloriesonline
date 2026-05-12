
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('prescriptions', 'prescriptions', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload own prescriptions"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'prescriptions' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own prescriptions"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'prescriptions' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins can read all prescriptions"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'prescriptions' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pharmacy vendors can read attached prescriptions"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'prescriptions'
  AND EXISTS (
    SELECT 1 FROM public.prescription_orders po
    JOIN public.vendors v ON v.id = po.vendor_id
    WHERE po.prescription_image_url LIKE '%' || storage.objects.name || '%'
      AND v.user_id = auth.uid()
  )
);
