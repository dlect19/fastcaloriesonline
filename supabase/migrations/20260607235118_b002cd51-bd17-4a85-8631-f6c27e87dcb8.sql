-- Add medicine classification to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS medicine_classification TEXT NOT NULL DEFAULT 'otc';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_medicine_classification_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_medicine_classification_check
  CHECK (medicine_classification IN ('otc','prescription','controlled'));

-- Backfill from legacy requires_prescription flag
UPDATE public.products
SET medicine_classification = CASE
  WHEN requires_prescription = true THEN 'prescription'
  ELSE 'otc'
END
WHERE medicine_classification = 'otc';

-- Keep legacy requires_prescription in sync with classification
CREATE OR REPLACE FUNCTION public.sync_requires_prescription()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.requires_prescription := (NEW.medicine_classification IN ('prescription','controlled'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_requires_prescription ON public.products;
CREATE TRIGGER trg_sync_requires_prescription
BEFORE INSERT OR UPDATE OF medicine_classification ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_requires_prescription();