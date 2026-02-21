
-- Drop the existing restrictive policy
DROP POLICY "Anyone can view available products" ON public.products;

-- Create new policy that allows anyone to view all products (availability shown in UI)
CREATE POLICY "Anyone can view products"
ON public.products
FOR SELECT
USING (true);
