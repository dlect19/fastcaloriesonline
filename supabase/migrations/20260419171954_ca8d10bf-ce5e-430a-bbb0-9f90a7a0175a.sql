-- Add dosage form and sachet pricing options to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS dosage_form text,
  ADD COLUMN IF NOT EXISTS allows_sachet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sachet_price numeric,
  ADD COLUMN IF NOT EXISTS sachet_unit_label text DEFAULT 'sachet',
  ADD COLUMN IF NOT EXISTS pack_unit_label text DEFAULT 'pack';

COMMENT ON COLUMN public.products.dosage_form IS 'For pharmacy products: tablet, capsule, syrup, drops, cream, injection, other';
COMMENT ON COLUMN public.products.allows_sachet IS 'When true, customers can buy this drug per sachet/strip in addition to the full pack (tablets/capsules only)';
COMMENT ON COLUMN public.products.sachet_price IS 'Price per single sachet/strip (when allows_sachet is true)';