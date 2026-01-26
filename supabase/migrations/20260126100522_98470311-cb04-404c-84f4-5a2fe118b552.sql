-- Create password reset OTPs table
CREATE TABLE public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  platform TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_password_reset_otps_email ON public.password_reset_otps(email);
CREATE INDEX idx_password_reset_otps_expires_at ON public.password_reset_otps(expires_at);

-- No public RLS policies - only accessible via service role in edge functions