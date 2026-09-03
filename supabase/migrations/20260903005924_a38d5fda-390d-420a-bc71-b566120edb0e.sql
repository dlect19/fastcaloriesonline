ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS allows_fractional_qty boolean NOT NULL DEFAULT false;

-- Correct selling units for existing rows using the more truthful serving_unit text
UPDATE public.products
SET portion_unit = lower(trim(substring(serving_unit from 5)))
WHERE serving_unit IS NOT NULL
  AND lower(trim(serving_unit)) ~ '^per (portion|plate|piece|bowl|pack|bottle|cup|kg|litre|liter)$'
  AND (portion_unit IS NULL OR portion_unit = 'plate')
  AND lower(trim(substring(serving_unit from 5))) <> 'plate';

UPDATE public.products SET portion_unit = 'plate' WHERE portion_unit IS NULL OR portion_unit = '';

-- Divisible units can be sold fractionally; counted units stay whole
UPDATE public.products
SET allows_fractional_qty = true
WHERE COALESCE(allows_sachet, false) = false
  AND lower(coalesce(portion_unit, '')) IN ('portion','plate','bowl','cup','kg','litre','liter','gram','g','ml');