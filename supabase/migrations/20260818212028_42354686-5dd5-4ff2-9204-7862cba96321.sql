-- 1. Settings table (admin-configurable, placeholder defaults)
CREATE TABLE IF NOT EXISTS public.rider_payout_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  is_placeholder boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.rider_payout_settings TO authenticated;
GRANT ALL ON public.rider_payout_settings TO service_role;
ALTER TABLE public.rider_payout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read rider payout settings"
  ON public.rider_payout_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage rider payout settings"
  ON public.rider_payout_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.rider_payout_settings TO authenticated;

INSERT INTO public.rider_payout_settings (key, value, description) VALUES
  ('charge_instant', '100', 'PLACEHOLDER — confirm with business. Transfer charge (NGN) deducted from the rider for instant/anytime withdrawals.'),
  ('charge_daily', '50', 'PLACEHOLDER — confirm with business. Transfer charge (NGN) deducted from the rider for daily automatic payouts.'),
  ('charge_weekly', '0', 'PLACEHOLDER — confirm with business. Transfer charge for weekly payouts (absorbed by FastCalories, rider is not debited).'),
  ('charge_monthly', '0', 'PLACEHOLDER — confirm with business. Transfer charge for monthly payouts (absorbed by FastCalories, rider is not debited).'),
  ('min_withdrawal', '1000', 'PLACEHOLDER — confirm with business. Minimum cleared balance (NGN) required for any rider payout.'),
  ('daily_run_time', '23:00', 'PLACEHOLDER — confirm with business. Daily automatic payout time (Africa/Lagos, 24h HH:MM).'),
  ('weekly_settlement_day', '5', 'PLACEHOLDER — confirm with business. Weekly settlement day (1=Monday ... 7=Sunday).'),
  ('monthly_settlement_date', 'last', 'PLACEHOLDER — confirm with business. Monthly settlement date (1-28 or "last").'),
  ('preference_change_rule', 'anytime', 'PLACEHOLDER — confirm with business. "anytime" (effective next cycle) or "once_per_cycle".'),
  ('instant_eta_text', 'Within 15 minutes – 24 hours', 'PLACEHOLDER — confirm with business. Estimated processing time shown to riders on the confirmation screen.')
ON CONFLICT (key) DO NOTHING;

-- 2. Rider payout preferences
CREATE TABLE IF NOT EXISTS public.rider_payout_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_user_id uuid NOT NULL UNIQUE,
  wallet_id uuid,
  payout_option text NOT NULL DEFAULT 'instant',
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  pending_option text,
  next_run_at timestamptz,
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  last_payout_cycle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_payout_preferences_option_chk CHECK (payout_option IN ('instant','daily','weekly','monthly')),
  CONSTRAINT rider_payout_preferences_pending_chk CHECK (pending_option IS NULL OR pending_option IN ('instant','daily','weekly','monthly'))
);

GRANT SELECT, INSERT, UPDATE ON public.rider_payout_preferences TO authenticated;
GRANT ALL ON public.rider_payout_preferences TO service_role;
ALTER TABLE public.rider_payout_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Riders manage own payout preference"
  ON public.rider_payout_preferences FOR ALL TO authenticated
  USING (rider_user_id = auth.uid())
  WITH CHECK (rider_user_id = auth.uid());

CREATE POLICY "Admins view all payout preferences"
  ON public.rider_payout_preferences FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Immutable withdrawal ledger
CREATE TABLE IF NOT EXISTS public.rider_withdrawal_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_reference text NOT NULL UNIQUE,
  payout_request_id uuid,
  rider_user_id uuid NOT NULL,
  wallet_id uuid,
  payout_option text NOT NULL DEFAULT 'instant',
  gross_amount numeric NOT NULL DEFAULT 0,
  transfer_charge numeric NOT NULL DEFAULT 0,
  charge_bearer text NOT NULL DEFAULT 'rider',
  net_amount numeric NOT NULL DEFAULT 0,
  balance_before numeric,
  balance_after numeric,
  bank_name text,
  bank_account_masked text,
  bank_account_name text,
  provider_reference text,
  status text NOT NULL DEFAULT 'requested',
  failure_reason text,
  idempotency_key text,
  environment text NOT NULL DEFAULT 'production',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_withdrawal_ledger_status_chk CHECK (status IN ('requested','processing','completed','failed','reversed','cancelled')),
  CONSTRAINT rider_withdrawal_ledger_bearer_chk CHECK (charge_bearer IN ('rider','fastcalories'))
);

CREATE INDEX IF NOT EXISTS idx_rider_withdrawal_ledger_rider ON public.rider_withdrawal_ledger(rider_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rider_withdrawal_ledger_option ON public.rider_withdrawal_ledger(payout_option, status);

GRANT SELECT ON public.rider_withdrawal_ledger TO authenticated;
GRANT ALL ON public.rider_withdrawal_ledger TO service_role;
ALTER TABLE public.rider_withdrawal_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Riders view own withdrawal ledger"
  ON public.rider_withdrawal_ledger FOR SELECT TO authenticated
  USING (rider_user_id = auth.uid());

CREATE POLICY "Admins view all withdrawal ledger"
  ON public.rider_withdrawal_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. Extend payout_requests
ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS payout_option text DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS transfer_charge numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charge_bearer text DEFAULT 'rider',
  ADD COLUMN IF NOT EXISTS net_amount numeric,
  ADD COLUMN IF NOT EXISTS withdrawal_reference text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_requests_idempotency
  ON public.payout_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 5. Mirror payout requests into the ledger
CREATE OR REPLACE FUNCTION public.sync_rider_withdrawal_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
  v_charge numeric;
  v_net numeric;
  v_bearer text;
  v_balance numeric;
BEGIN
  IF NEW.user_type IS DISTINCT FROM 'rider' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_ref := COALESCE(NEW.withdrawal_reference, 'RW-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8)));
    v_charge := COALESCE(NEW.transfer_charge, 0);
    v_bearer := COALESCE(NEW.charge_bearer, 'rider');
    v_net := COALESCE(NEW.net_amount, CASE WHEN v_bearer = 'rider' THEN NEW.amount - v_charge ELSE NEW.amount END);

    SELECT balance INTO v_balance FROM public.wallets WHERE id = NEW.wallet_id;

    INSERT INTO public.rider_withdrawal_ledger (
      withdrawal_reference, payout_request_id, rider_user_id, wallet_id, payout_option,
      gross_amount, transfer_charge, charge_bearer, net_amount,
      balance_before, balance_after,
      bank_name, bank_account_masked, bank_account_name,
      provider_reference, status, idempotency_key, environment
    ) VALUES (
      v_ref, NEW.id, NEW.user_id, NEW.wallet_id, COALESCE(NEW.payout_option, 'instant'),
      NEW.amount, v_charge, v_bearer, v_net,
      COALESCE(v_balance, 0) + NEW.amount, COALESCE(v_balance, 0),
      NEW.bank_name,
      CASE WHEN NEW.bank_account_number IS NULL THEN NULL
           ELSE '******' || right(NEW.bank_account_number, 4) END,
      NEW.bank_account_name,
      COALESCE(NEW.paystack_transfer_code, NEW.paystack_reference),
      CASE WHEN NEW.status = 'processing' THEN 'processing' ELSE 'requested' END,
      NEW.idempotency_key,
      COALESCE(NEW.environment, 'production')
    )
    ON CONFLICT (withdrawal_reference) DO NOTHING;

    RETURN NEW;
  END IF;

  -- UPDATE: mirror status / provider reference / failure reason
  UPDATE public.rider_withdrawal_ledger l
  SET status = CASE
        WHEN NEW.status = 'completed' THEN 'completed'
        WHEN NEW.status = 'failed' THEN 'failed'
        WHEN NEW.status = 'reversed' THEN 'reversed'
        WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.status = 'processing' THEN 'processing'
        ELSE l.status END,
      provider_reference = COALESCE(NEW.paystack_transfer_code, NEW.paystack_reference, l.provider_reference),
      failure_reason = COALESCE(NEW.failure_reason, l.failure_reason),
      balance_after = CASE
        WHEN NEW.status IN ('failed', 'reversed', 'cancelled')
          THEN (SELECT balance FROM public.wallets WHERE id = NEW.wallet_id)
        ELSE l.balance_after END,
      updated_at = now()
  WHERE l.payout_request_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_rider_withdrawal_ledger_ins ON public.payout_requests;
CREATE TRIGGER trg_sync_rider_withdrawal_ledger_ins
  AFTER INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_withdrawal_ledger();

DROP TRIGGER IF EXISTS trg_sync_rider_withdrawal_ledger_upd ON public.payout_requests;
CREATE TRIGGER trg_sync_rider_withdrawal_ledger_upd
  AFTER UPDATE OF status, paystack_transfer_code, paystack_reference, failure_reason ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_withdrawal_ledger();

-- 6. Migrate existing rider auto-withdraw settings into preferences
INSERT INTO public.rider_payout_preferences (rider_user_id, wallet_id, payout_option, bank_name, bank_account_number, bank_account_name)
SELECT w.user_id, w.id,
       CASE WHEN COALESCE(w.auto_withdraw, false) THEN 'weekly' ELSE 'instant' END,
       w.bank_name, w.bank_account_number, w.bank_account_name
FROM public.wallets w
WHERE w.wallet_type = 'rider' AND w.user_id IS NOT NULL
ON CONFLICT (rider_user_id) DO NOTHING;