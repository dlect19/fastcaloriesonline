
CREATE POLICY "Users read own voucher images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'voucher-images' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "Users upload voucher images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voucher-images');
