
CREATE TABLE public.withdrawal_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  user_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ
);

ALTER TABLE public.withdrawal_otps ENABLE ROW LEVEL SECURITY;

-- Only service role (edge functions) should access this table
-- No client-side access needed

CREATE INDEX idx_withdrawal_otps_lookup ON public.withdrawal_otps(email, otp_code) WHERE used = FALSE;
CREATE INDEX idx_withdrawal_otps_expires ON public.withdrawal_otps(expires_at) WHERE used = FALSE;
