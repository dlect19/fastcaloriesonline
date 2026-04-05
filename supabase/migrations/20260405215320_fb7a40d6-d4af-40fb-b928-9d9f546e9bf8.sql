ALTER TABLE public.ambassadors 
  ADD COLUMN IF NOT EXISTS discount_percentage numeric DEFAULT 10 NOT NULL;