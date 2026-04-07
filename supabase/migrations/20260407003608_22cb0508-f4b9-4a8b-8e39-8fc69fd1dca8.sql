CREATE POLICY "Admin staff can read all calorie logs"
ON public.calorie_logs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE admin_staff.user_id = auth.uid()
    AND admin_staff.is_active = true
  )
);