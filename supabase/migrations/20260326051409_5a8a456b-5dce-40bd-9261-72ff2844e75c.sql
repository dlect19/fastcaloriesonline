-- Drop the existing restrictive INSERT policy
DROP POLICY "Vendor owners can create outlets" ON public.vendor_outlets;

-- Recreate with owns_vendor function which includes both owners AND active staff
CREATE POLICY "Vendor owners and staff can create outlets"
ON public.vendor_outlets
FOR INSERT
TO authenticated
WITH CHECK (owns_vendor(auth.uid(), vendor_id));