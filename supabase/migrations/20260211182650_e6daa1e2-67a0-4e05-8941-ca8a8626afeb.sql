
-- Update SELECT policy on products to also allow vendor staff to see unavailable products
DROP POLICY IF EXISTS "Anyone can view available products" ON public.products;
CREATE POLICY "Anyone can view available products" 
ON public.products 
FOR SELECT 
USING (
  (is_available = true) 
  OR owns_vendor(auth.uid(), vendor_id)
  OR (get_vendor_staff_role(auth.uid(), vendor_id) IS NOT NULL)
);

-- Also update the manage policy to allow managers to manage products
DROP POLICY IF EXISTS "Vendor owners can manage products" ON public.products;
CREATE POLICY "Vendor owners can manage products" 
ON public.products 
FOR ALL 
USING (
  owns_vendor(auth.uid(), vendor_id) 
  OR (get_vendor_staff_role(auth.uid(), vendor_id) = ANY (ARRAY['owner'::vendor_staff_role, 'manager'::vendor_staff_role]))
);
