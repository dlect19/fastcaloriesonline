-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Vendor owners and staff can create outlets" ON public.vendor_outlets;
DROP POLICY IF EXISTS "Vendor owners can create outlets" ON public.vendor_outlets;

-- Create a robust INSERT policy for vendor owners, staff, AND admins
CREATE POLICY "Vendors and admins can create outlets"
ON public.vendor_outlets
FOR INSERT
TO authenticated
WITH CHECK (
  owns_vendor(auth.uid(), vendor_id)
  OR has_role(auth.uid(), 'admin'::app_role)
);