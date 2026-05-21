
CREATE TABLE IF NOT EXISTS public.pos_wallet_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_vendor_id uuid,
  used_for_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_codes_user_active
  ON public.pos_wallet_auth_codes(user_id, expires_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_codes_code_active
  ON public.pos_wallet_auth_codes(code) WHERE used_at IS NULL;

ALTER TABLE public.pos_wallet_auth_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own POS codes"
  ON public.pos_wallet_auth_codes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users create their own POS codes"
  ON public.pos_wallet_auth_codes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own POS codes"
  ON public.pos_wallet_auth_codes FOR UPDATE
  USING (auth.uid() = user_id);

INSERT INTO public.platform_settings (key, value, description)
VALUES ('pos_wallet_fee_percentage', '1.5', 'Platform service fee % charged on in-store POS wallet payments')
ON CONFLICT (key) DO NOTHING;
