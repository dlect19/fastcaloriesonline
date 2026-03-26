-- Fix vendor outlet visibility check so INSERT ... RETURNING works for non-admin vendor owners
DROP POLICY IF EXISTS "Anyone can view approved active outlets" ON public.vendor_outlets;

CREATE POLICY "Anyone can view approved active outlets"
ON public.vendor_outlets
FOR SELECT
TO public
USING (
  (
    is_approved = true
    AND is_active = true
  )
  OR owns_vendor(auth.uid(), vendor_id)
  OR has_role(auth.uid(), 'admin'::app_role)
);