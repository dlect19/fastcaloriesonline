ALTER TABLE public.vendors 
  ADD COLUMN IF NOT EXISTS store_type text NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS social_media_handles jsonb DEFAULT '{}';

COMMENT ON COLUMN public.vendors.store_type IS 'physical, online, or both';
COMMENT ON COLUMN public.vendors.social_media_handles IS 'JSON object with platform keys (instagram, tiktok, x, facebook, whatsapp, youtube) and handle values';