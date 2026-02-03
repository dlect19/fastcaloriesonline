-- Add packaging_fee column to orders table
ALTER TABLE public.orders
ADD COLUMN packaging_fee numeric DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.orders.packaging_fee IS 'Takeaway pack/packaging fee charged to customer';