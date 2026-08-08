CREATE TABLE IF NOT EXISTS public.wallet_balance_guard_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL,
  column_name text NOT NULL,
  old_value numeric,
  new_value numeric,
  delta numeric,
  session_user_name text,
  current_role_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wallet_balance_guard_log TO authenticated;
GRANT ALL ON public.wallet_balance_guard_log TO service_role;
ALTER TABLE public.wallet_balance_guard_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view balance guard log"
  ON public.wallet_balance_guard_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.wallet_drift_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  wallet_balance numeric NOT NULL DEFAULT 0,
  ledger_balance numeric NOT NULL DEFAULT 0,
  drift numeric NOT NULL DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wallet_drift_audit TO authenticated;
GRANT ALL ON public.wallet_drift_audit TO service_role;
ALTER TABLE public.wallet_drift_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view drift audit"
  ON public.wallet_drift_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_wallet_drift_audit_detected ON public.wallet_drift_audit(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_guard_log_created ON public.wallet_balance_guard_log(created_at DESC);

-- Log (but do not block) any monetary column change made without the official posting path
CREATE OR REPLACE FUNCTION public.log_unguarded_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass boolean := COALESCE(current_setting('app.bypass_balance_trigger', true), 'off') IN ('on','true');
BEGIN
  IF v_bypass THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.balance,0) <> COALESCE(OLD.balance,0) THEN
    INSERT INTO public.wallet_balance_guard_log (
      wallet_id, column_name, old_value, new_value, delta, session_user_name, current_role_name
    ) VALUES (
      NEW.id, 'balance', OLD.balance, NEW.balance,
      COALESCE(NEW.balance,0) - COALESCE(OLD.balance,0),
      session_user::text, current_setting('role', true)
    );
  END IF;

  IF COALESCE(NEW.test_balance,0) <> COALESCE(OLD.test_balance,0) THEN
    INSERT INTO public.wallet_balance_guard_log (
      wallet_id, column_name, old_value, new_value, delta, session_user_name, current_role_name
    ) VALUES (
      NEW.id, 'test_balance', OLD.test_balance, NEW.test_balance,
      COALESCE(NEW.test_balance,0) - COALESCE(OLD.test_balance,0),
      session_user::text, current_setting('role', true)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_unguarded_balance_change ON public.wallets;
CREATE TRIGGER trg_log_unguarded_balance_change
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.log_unguarded_balance_change();

-- Drift detector: records every wallet whose balance disagrees with its ledger
CREATE OR REPLACE FUNCTION public.detect_wallet_drift(p_environment text DEFAULT NULL)
RETURNS TABLE(wallets_checked integer, drifted integer, total_drift numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean := (v_env = 'development');
  v_checked integer := 0;
  v_drifted integer := 0;
  v_total numeric := 0;
BEGIN
  WITH led AS (
    SELECT wallet_id,
           SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS ledger
    FROM public.wallet_transactions
    WHERE status = 'completed' AND environment = v_env
    GROUP BY wallet_id
  ), calc AS (
    SELECT w.id,
           CASE WHEN v_is_test THEN COALESCE(w.test_balance,0) ELSE COALESCE(w.balance,0) END AS bal,
           COALESCE(l.ledger,0) AS ledger
    FROM public.wallets w
    LEFT JOIN led l ON l.wallet_id = w.id
  ), ins AS (
    INSERT INTO public.wallet_drift_audit (wallet_id, environment, wallet_balance, ledger_balance, drift)
    SELECT id, v_env, bal, ledger, bal - ledger FROM calc
    WHERE abs(bal - ledger) > 0.01
    RETURNING drift
  )
  SELECT (SELECT count(*) FROM calc), (SELECT count(*) FROM ins), COALESCE((SELECT sum(abs(drift)) FROM ins), 0)
  INTO v_checked, v_drifted, v_total;

  RETURN QUERY SELECT v_checked, v_drifted, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_wallet_drift(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_wallet_drift(text) TO service_role;