ALTER TABLE public.ad_placements ADD COLUMN IF NOT EXISTS cta_label text;
ALTER TABLE public.advertisements ADD COLUMN IF NOT EXISTS cta_label text;