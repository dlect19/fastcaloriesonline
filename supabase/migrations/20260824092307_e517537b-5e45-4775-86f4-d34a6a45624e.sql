CREATE TABLE IF NOT EXISTS public.admin_2fa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_admin_2fa_sessions_user ON public.admin_2fa_sessions(user_id);
GRANT ALL ON public.admin_2fa_sessions TO service_role;
ALTER TABLE public.admin_2fa_sessions ENABLE ROW LEVEL SECURITY;