-- Change default for approved_for_live to true for new vendors
ALTER TABLE public.vendors ALTER COLUMN approved_for_live SET DEFAULT true;

-- Update existing vendors to be approved for live (unless they're test stores)
UPDATE public.vendors SET approved_for_live = true WHERE is_test_store = false;