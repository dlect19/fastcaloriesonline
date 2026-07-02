
-- Phone verification columns on profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_verification_method text;

-- OTP table
CREATE TABLE IF NOT EXISTS public.phone_verification_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  purpose text NOT NULL DEFAULT 'verify',
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone_created ON public.phone_verification_otps(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_otps_user ON public.phone_verification_otps(user_id);

GRANT SELECT ON public.phone_verification_otps TO authenticated;
GRANT ALL ON public.phone_verification_otps TO service_role;

ALTER TABLE public.phone_verification_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own OTP records"
  ON public.phone_verification_otps FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages OTP records"
  ON public.phone_verification_otps FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Platform setting for force phone verification
INSERT INTO public.platform_settings (key, value, description)
VALUES ('force_phone_verification', 'off', 'Enforcement scope: off | customers | professionals | all | all_and_signups')
ON CONFLICT (key) DO NOTHING;
