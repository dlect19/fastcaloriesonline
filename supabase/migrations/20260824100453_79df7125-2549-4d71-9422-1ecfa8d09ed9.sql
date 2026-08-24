-- Remove browser-side write access to admin_staff; all mutations now go through
-- the hardened admin-staff-manage / create-staff-account edge functions (service role),
-- which require an active super admin plus a fresh authenticator TOTP step-up.
DROP POLICY IF EXISTS "Super admins can manage admin staff" ON public.admin_staff;

CREATE POLICY "Super admins can view admin staff"
ON public.admin_staff
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

GRANT SELECT ON public.admin_staff TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_staff FROM authenticated;
GRANT ALL ON public.admin_staff TO service_role;