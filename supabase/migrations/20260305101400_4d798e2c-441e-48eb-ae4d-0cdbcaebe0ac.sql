
ALTER TABLE public.vendor_outlets
  ADD COLUMN IF NOT EXISTS store_type text DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS social_media_handles jsonb DEFAULT '{}'::jsonb;
