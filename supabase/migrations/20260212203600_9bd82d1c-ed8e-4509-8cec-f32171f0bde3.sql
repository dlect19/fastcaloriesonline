-- Add is_open column to vendors for quick store toggle
ALTER TABLE public.vendors ADD COLUMN is_open boolean NOT NULL DEFAULT true;

-- Update vendor_working_hours RLS to allow staff with edit_settings permission
DROP POLICY IF EXISTS "Vendor owners can manage hours" ON public.vendor_working_hours;

CREATE POLICY "Vendor owners and staff can manage hours" 
ON public.vendor_working_hours 
FOR ALL 
USING (
  owns_vendor(auth.uid(), vendor_id) 
  OR get_vendor_staff_role(auth.uid(), vendor_id) IN ('owner', 'manager')
)
WITH CHECK (
  owns_vendor(auth.uid(), vendor_id) 
  OR get_vendor_staff_role(auth.uid(), vendor_id) IN ('owner', 'manager')
);