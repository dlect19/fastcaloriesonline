
-- Create junction table to link products to shared addon groups
CREATE TABLE public.product_addon_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  addon_group_id UUID NOT NULL REFERENCES public.addon_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(product_id, addon_group_id)
);

-- Enable RLS
ALTER TABLE public.product_addon_groups ENABLE ROW LEVEL SECURITY;

-- Vendors can manage their own product-addon links
CREATE POLICY "Vendors can view product addon links for their products"
ON public.product_addon_groups FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.vendors v ON v.id = p.vendor_id
    WHERE p.id = product_addon_groups.product_id
    AND (v.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs 
      WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
    ))
  )
);

CREATE POLICY "Vendors can insert product addon links"
ON public.product_addon_groups FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.vendors v ON v.id = p.vendor_id
    WHERE p.id = product_addon_groups.product_id
    AND (v.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs 
      WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
    ))
  )
);

CREATE POLICY "Vendors can delete product addon links"
ON public.product_addon_groups FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.vendors v ON v.id = p.vendor_id
    WHERE p.id = product_addon_groups.product_id
    AND (v.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs 
      WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
    ))
  )
);

-- Customers can view product addon links (for ordering)
CREATE POLICY "Anyone can view product addon links"
ON public.product_addon_groups FOR SELECT
USING (true);

-- Migrate existing data: create junction entries from current product_id on addon_groups
INSERT INTO public.product_addon_groups (product_id, addon_group_id)
SELECT product_id, id FROM public.addon_groups
WHERE product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Make product_id nullable on addon_groups (groups are now vendor-level)
ALTER TABLE public.addon_groups ALTER COLUMN product_id DROP NOT NULL;

-- Add index for performance
CREATE INDEX idx_product_addon_groups_product ON public.product_addon_groups(product_id);
CREATE INDEX idx_product_addon_groups_addon ON public.product_addon_groups(addon_group_id);
