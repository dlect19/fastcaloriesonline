
-- Allow admins to read all wallets (needed for admin dashboard rider/vendor breakdowns)
CREATE POLICY "Admins can view all wallets"
ON public.wallets
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);
