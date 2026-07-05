DROP POLICY IF EXISTS "Admins can manage platform settings" ON public.platform_settings;

CREATE POLICY "Admins can manage platform settings"
ON public.platform_settings
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.admin_staff s WHERE s.user_id = auth.uid() AND s.is_active = true)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.admin_staff s WHERE s.user_id = auth.uid() AND s.is_active = true)
);