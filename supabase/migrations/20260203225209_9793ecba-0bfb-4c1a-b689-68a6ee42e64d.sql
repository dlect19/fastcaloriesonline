-- Fix linter: RLS enabled but no policy on password_reset_otps
-- This table contains sensitive OTP + email data and should not be directly accessible from the client.
-- Backend functions can still access it using the service role.

CREATE POLICY "No direct access to password reset otps"
ON public.password_reset_otps
FOR ALL
USING (false)
WITH CHECK (false);