
-- Table to store vendor saved ad images (max 5 per vendor)
CREATE TABLE public.vendor_ad_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  format TEXT,
  source TEXT DEFAULT 'upload', -- 'upload' or 'ai_generated'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_ad_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors can view own ad images"
  ON public.vendor_ad_images FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Vendors can insert own ad images"
  ON public.vendor_ad_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Vendors can delete own ad images"
  ON public.vendor_ad_images FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_vendor_ad_images_vendor ON public.vendor_ad_images(vendor_id);
