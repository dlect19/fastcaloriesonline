-- Allow riders to view vendor details for orders assigned to them
CREATE POLICY "Riders can view vendors for their assigned orders"
ON public.vendors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.vendor_id = vendors.id
      AND orders.rider_id = auth.uid()
  )
);

-- Allow vendor staff to view their vendor
CREATE POLICY "Vendor staff can view their vendor"
ON public.vendors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM vendor_staff vs
    WHERE vs.vendor_id = vendors.id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
);