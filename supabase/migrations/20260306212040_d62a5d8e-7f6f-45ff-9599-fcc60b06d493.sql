CREATE POLICY "Admins can view all order items"
ON public.order_items FOR SELECT
TO authenticated
USING (get_admin_staff_role(auth.uid()) IS NOT NULL);