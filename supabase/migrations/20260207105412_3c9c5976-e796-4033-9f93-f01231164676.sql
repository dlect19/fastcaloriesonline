-- Add discount_price column to products table
ALTER TABLE public.products ADD COLUMN discount_price numeric NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.products.discount_price IS 'Optional discounted price set by vendor. When set and less than price, shows as active discount.';