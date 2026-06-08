
-- 1. admin_2fa_settings
CREATE TABLE public.admin_2fa_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_method TEXT NOT NULL DEFAULT 'email' CHECK (preferred_method IN ('email','totp')),
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  totp_enrolled_at TIMESTAMPTZ,
  backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_2fa_settings TO authenticated;
GRANT ALL ON public.admin_2fa_settings TO service_role;
ALTER TABLE public.admin_2fa_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own 2fa settings" ON public.admin_2fa_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 2. admin_otp_codes
CREATE TABLE public.admin_otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'email',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  attempts INT NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_otp_user ON public.admin_otp_codes(user_id, created_at DESC);
GRANT ALL ON public.admin_otp_codes TO service_role;
ALTER TABLE public.admin_otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only otp" ON public.admin_otp_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. admin_login_activity
CREATE TABLE public.admin_login_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  device_fingerprint TEXT,
  was_new_device BOOLEAN NOT NULL DEFAULT false,
  location_city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_login_activity_user ON public.admin_login_activity(user_id, created_at DESC);
GRANT SELECT ON public.admin_login_activity TO authenticated;
GRANT ALL ON public.admin_login_activity TO service_role;
ALTER TABLE public.admin_login_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own login activity" ON public.admin_login_activity FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 4. admin_login_attempts
CREATE TABLE public.admin_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','fail')),
  failure_reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_login_attempts_user ON public.admin_login_attempts(user_id, created_at DESC);
GRANT SELECT ON public.admin_login_attempts TO authenticated;
GRANT ALL ON public.admin_login_attempts TO service_role;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin view attempts" ON public.admin_login_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 5. admin_lockouts
CREATE TABLE public.admin_lockouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_lockouts_user ON public.admin_lockouts(user_id, locked_until DESC);
GRANT SELECT, DELETE ON public.admin_lockouts TO authenticated;
GRANT ALL ON public.admin_lockouts TO service_role;
ALTER TABLE public.admin_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view lockouts" ON public.admin_lockouts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "super admin unlock" ON public.admin_lockouts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- helper: is admin currently locked out
CREATE OR REPLACE FUNCTION public.is_admin_locked_out(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_lockouts
    WHERE user_id = _user_id AND locked_until > now()
  );
$$;

-- helper: count recent failed attempts in window
CREATE OR REPLACE FUNCTION public.admin_recent_failed_attempts(_user_id UUID, _window_minutes INT DEFAULT 15)
RETURNS INT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INT FROM public.admin_login_attempts
  WHERE user_id = _user_id
    AND outcome = 'fail'
    AND created_at > now() - (_window_minutes || ' minutes')::interval;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_admin_2fa_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_touch_admin_2fa
  BEFORE UPDATE ON public.admin_2fa_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_admin_2fa_settings();
