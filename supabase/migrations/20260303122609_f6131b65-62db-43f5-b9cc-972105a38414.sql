
-- Create storage bucket for rider documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('rider-documents', 'rider-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow riders to upload their own documents
CREATE POLICY "Riders can upload own documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rider-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow riders to view their own documents
CREATE POLICY "Riders can view own documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'rider-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow admins to view all rider documents
CREATE POLICY "Admins can view all rider documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'rider-documents' AND
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Allow public read access for admin viewing
CREATE POLICY "Public read rider documents"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'rider-documents');
