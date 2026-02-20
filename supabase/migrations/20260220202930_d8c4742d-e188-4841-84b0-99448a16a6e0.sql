
-- 1. Add description and pricing_type to addon_items
ALTER TABLE public.addon_items 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'per_piece';

-- 2. Add sales_radius to vendors (vendor-controlled, in km)
ALTER TABLE public.vendors
ADD COLUMN IF NOT EXISTS sales_radius numeric DEFAULT 10;

-- 3. Add max_capacity to takeaway_packs for non-overlapping size logic
ALTER TABLE public.takeaway_packs
ADD COLUMN IF NOT EXISTS max_capacity integer;

-- Add comment for clarity
COMMENT ON COLUMN public.addon_items.pricing_type IS 'per_piece = customer selects qty, fixed = applies once per order';
COMMENT ON COLUMN public.vendors.sales_radius IS 'Vendor sales radius in km. Customers outside this radius cannot see the vendor.';
COMMENT ON COLUMN public.takeaway_packs.max_capacity IS 'Maximum capacity for this pack size. The next larger pack starts from max_capacity + 1.';
