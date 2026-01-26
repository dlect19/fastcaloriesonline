-- Create email verification OTPs table
CREATE TABLE public.email_verification_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  platform TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_verification_otps ENABLE ROW LEVEL SECURITY;

-- Policy for users to view own OTPs
CREATE POLICY "Users can view own verification OTPs" ON public.email_verification_otps
FOR SELECT USING (auth.uid() = user_id);

-- Add NIN fields to rider_profiles
ALTER TABLE public.rider_profiles 
  ADD COLUMN IF NOT EXISTS nin_number TEXT,
  ADD COLUMN IF NOT EXISTS nin_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nin_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT false;