-- Allow riders to view customer profiles for orders assigned to them
CREATE POLICY "Riders can view customer profiles for assigned orders"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.user_id = profiles.user_id
      AND orders.rider_id = auth.uid()
  )
);