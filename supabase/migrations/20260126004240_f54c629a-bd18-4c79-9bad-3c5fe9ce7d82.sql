-- Add serving_unit column to products table for restaurant meals
ALTER TABLE public.products 
ADD COLUMN serving_unit text DEFAULT 'per plate';

-- Add a comment explaining the valid values
COMMENT ON COLUMN public.products.serving_unit IS 'Serving unit for pricing: per plate, per portion, per piece, per pack, per bowl';