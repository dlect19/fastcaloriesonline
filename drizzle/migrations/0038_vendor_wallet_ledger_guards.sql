-- Vendor wallet ledger-truth guards: full-ledger buckets, payout drift freeze, audited correction.

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS payout_frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_frozen_reason text,
  ADD COLUMN IF NOT EXISTS payout_frozen_at timestamptz;

CREATE OR REPLACE FUNCTION public.wallet_ledger_net(p_wallet_id uuid, p_environment text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND status = 'completed' AND environment = p_environment;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_vendor_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_env text := get_platform_environment();
  v_is_test boolean := (v_env = 'development');
  v_stored numeric;
  v_ledger numeric;
  v_pending_menu numeric;
  v_pending_rider numeric;
  v_unrel_menu numeric;
  v_unrel_rider numeric;
  v_rider_formula numeric;
  v_eligible numeric;
  v_rider numeric;
  v_menu numeric;
BEGIN
  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_stored FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_ledger := public.wallet_ledger_net(p_wallet_id, v_env);

  IF abs(v_stored - v_ledger) > 0.01 THEN
    UPDATE public.wallets SET
      payout_frozen = true,
      payout_frozen_at = COALESCE(payout_frozen_at, now()),
      payout_frozen_reason = format('Ledger drift ₦%s (stored ₦%s vs ledger ₦%s, %s). Payouts frozen until an audited correction.',
                                    v_stored - v_ledger, v_stored, v_ledger, v_env)
    WHERE id = p_wallet_id;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE category IN ('vendor_share','voucher_sale') AND status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category = 'vendor_rider_share' AND status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('vendor_share','voucher_sale') AND status = 'completed' AND COALESCE(release_at, created_at) > now()), 0),
    COALESCE(SUM(amount) FILTER (WHERE category = 'vendor_rider_share' AND status = 'completed' AND COALESCE(release_at, created_at) > now()), 0)
  INTO v_pending_menu, v_pending_rider, v_unrel_menu, v_unrel_rider
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env AND transaction_type = 'credit';

  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed'
         AND COALESCE(release_at, created_at) <= now() THEN amount
    WHEN category = 'vendor_rider_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND status = 'completed' AND COALESCE(notes,'') ILIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND status = 'completed' AND COALESCE(notes,'') ILIKE '%Rider Revenue%' THEN amount
    ELSE 0 END), 0)
  INTO v_rider_formula
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  v_eligible := GREATEST(LEAST(v_ledger, v_stored) - v_unrel_menu - v_unrel_rider, 0);
  v_rider := LEAST(GREATEST(v_rider_formula, 0), v_eligible);
  v_menu := v_eligible - v_rider;

  PERFORM set_config('app.bypass_balance_trigger', 'on', true);
  IF v_is_test THEN
    UPDATE public.wallets SET
      test_eligible_balance = v_eligible,
      test_menu_earnings_balance = v_menu,
      test_rider_revenue_balance = v_rider,
      test_menu_earnings_pending = v_pending_menu + v_unrel_menu,
      test_pending_balance = v_pending_menu + v_pending_rider + v_unrel_menu + v_unrel_rider,
      updated_at = now()
    WHERE id = p_wallet_id;
  ELSE
    UPDATE public.wallets SET
      eligible_balance = v_eligible,
      menu_earnings_balance = v_menu,
      rider_revenue_balance = v_rider,
      menu_earnings_pending = v_pending_menu + v_unrel_menu,
      pending_balance = v_pending_menu + v_pending_rider + v_unrel_menu + v_unrel_rider,
      updated_at = now()
    WHERE id = p_wallet_id;
  END IF;
  PERFORM set_config('app.bypass_balance_trigger', 'off', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_vendor_wallet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_vendor_wallet(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.wallet_ledger_net(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_net(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.deduct_wallet_on_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet RECORD;
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
  v_available NUMERIC;
  v_eligible NUMERIC;
  v_stored NUMERIC;
  v_ledger NUMERIC;
  v_unreleased NUMERIC;
  v_notes TEXT;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_amount := NEW.amount;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');
  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF COALESCE(v_wallet.payout_frozen, false) THEN
    RAISE EXCEPTION 'PAYOUT_FROZEN: %', COALESCE(v_wallet.payout_frozen_reason, 'Wallet is under review. Contact support.');
  END IF;

  v_stored := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_balance,0) ELSE COALESCE(v_wallet.balance,0) END;
  v_ledger := public.wallet_ledger_net(NEW.wallet_id, NEW.environment);
  IF abs(v_stored - v_ledger) > 0.01 THEN
    RAISE EXCEPTION 'PAYOUT_FROZEN_LEDGER_DRIFT: stored ₦% vs ledger ₦%. Payout blocked until an audited correction.', v_stored, v_ledger;
  END IF;

  IF NEW.user_type = 'vendor' THEN
    PERFORM public.reconcile_vendor_wallet(NEW.wallet_id);
    SELECT * INTO v_wallet FROM public.wallets WHERE id = NEW.wallet_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_unreleased
  FROM public.wallet_transactions
  WHERE wallet_id = NEW.wallet_id AND environment = NEW.environment
    AND transaction_type = 'credit' AND status = 'completed'
    AND category IN ('vendor_share','voucher_sale','vendor_rider_share')
    AND COALESCE(release_at, created_at) > now();

  v_eligible := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_eligible_balance, 0) ELSE COALESCE(v_wallet.eligible_balance, 0) END;

  IF NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN
    v_available := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_rider_revenue_balance, 0) ELSE COALESCE(v_wallet.rider_revenue_balance, 0) END;
  ELSIF NEW.user_type = 'vendor' THEN
    v_available := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_menu_earnings_balance, 0) ELSE COALESCE(v_wallet.menu_earnings_balance, 0) END;
  ELSE
    v_available := v_eligible;
  END IF;

  v_available := GREATEST(LEAST(v_available, v_eligible, v_ledger - v_unreleased), 0);

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  v_notes := CASE
    WHEN NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN 'Withdrawal - Rider Revenue'
    WHEN NEW.user_type = 'vendor' THEN 'Withdrawal - Menu Earnings'
    ELSE 'Withdrawal'
  END;

  PERFORM public.post_wallet_entry(
    p_wallet_id => NEW.wallet_id,
    p_wallet_type => COALESCE(NEW.user_type, 'rider'),
    p_transaction_type => 'debit',
    p_category => 'withdrawal',
    p_amount => v_amount,
    p_reference => 'PAYOUT-REQ-' || NEW.id::text,
    p_environment => NEW.environment,
    p_order_id => NULL,
    p_notes => v_notes,
    p_metadata => jsonb_build_object(
      'payout_request_id', NEW.id,
      'user_type', NEW.user_type,
      'withdrawal_source', v_source,
      'source', 'deduct_wallet_on_payout_request'
    )
  );

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_rider_revenue_balance = GREATEST(COALESCE(test_rider_revenue_balance, 0) - v_amount, 0),
        test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        rider_revenue_balance = GREATEST(COALESCE(rider_revenue_balance, 0) - v_amount, 0),
        eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  ELSIF NEW.user_type = 'vendor' THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_balance = GREATEST(COALESCE(test_menu_earnings_balance, 0) - v_amount, 0),
        test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_balance = GREATEST(COALESCE(menu_earnings_balance, 0) - v_amount, 0),
        eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  ELSE
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_payout_has_ledger_debit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.wallet_transactions
  WHERE wallet_id = NEW.wallet_id
    AND reference = 'PAYOUT-REQ-' || NEW.id::text
    AND category = 'withdrawal' AND transaction_type = 'debit'
    AND status = 'completed' AND amount = NEW.amount
    AND environment = NEW.environment;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_MISMATCH: payout % has % matching ledger debits (expected 1)', NEW.id, v_n;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assert_payout_has_ledger_debit ON public.payout_requests;
CREATE CONSTRAINT TRIGGER trg_assert_payout_has_ledger_debit
  AFTER INSERT ON public.payout_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_payout_has_ledger_debit();

CREATE OR REPLACE FUNCTION public.detect_wallet_drift(p_environment text DEFAULT NULL::text)
RETURNS TABLE(wallets_checked integer, drifted integer, total_drift numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean := (v_env = 'development');
  v_checked integer := 0;
  v_drifted integer := 0;
  v_total numeric := 0;
  v_pf_bal numeric := 0;
  v_pf_ledger numeric := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _drift_calc (id uuid, wallet_type text, bal numeric, ledger numeric) ON COMMIT DROP;
  TRUNCATE _drift_calc;

  INSERT INTO _drift_calc
  SELECT w.id, w.wallet_type,
         CASE WHEN v_is_test THEN COALESCE(w.test_balance,0) ELSE COALESCE(w.balance,0) END,
         COALESCE(l.ledger, 0)
  FROM public.wallets w
  LEFT JOIN (
    SELECT wallet_id, SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS ledger
    FROM public.wallet_transactions
    WHERE status = 'completed' AND environment = v_env AND wallet_id IS NOT NULL
    GROUP BY wallet_id
  ) l ON l.wallet_id = w.id;

  INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
  SELECT id, wallet_type, v_env, bal, ledger, bal - ledger FROM _drift_calc WHERE abs(bal - ledger) > 0.01;

  UPDATE public.wallets w SET
    payout_frozen = true,
    payout_frozen_at = COALESCE(w.payout_frozen_at, now()),
    payout_frozen_reason = format('Daily drift check: stored ₦%s vs ledger ₦%s (%s). Payouts frozen until an audited correction.', c.bal, c.ledger, v_env)
  FROM _drift_calc c
  WHERE c.id = w.id AND abs(c.bal - c.ledger) > 0.01;

  SELECT count(*), count(*) FILTER (WHERE abs(bal - ledger) > 0.01),
         COALESCE(sum(abs(bal - ledger)) FILTER (WHERE abs(bal - ledger) > 0.01), 0)
  INTO v_checked, v_drifted, v_total FROM _drift_calc;

  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_pf_bal FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  IF v_pf_bal IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
    INTO v_pf_ledger
    FROM public.wallet_transactions
    WHERE wallet_type = 'platform' AND status = 'completed' AND environment = v_env;

    v_checked := v_checked + 1;
    IF abs(v_pf_bal - v_pf_ledger) > 0.01 THEN
      INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
      VALUES (NULL, 'platform', v_env, v_pf_bal, v_pf_ledger, v_pf_bal - v_pf_ledger);
      v_drifted := v_drifted + 1;
      v_total := v_total + abs(v_pf_bal - v_pf_ledger);
    END IF;
  END IF;

  RETURN QUERY SELECT v_checked, v_drifted, v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_vendor_wallet_drift_preview(p_wallet_id uuid, p_environment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_w record;
  v_ledger numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT * INTO v_w FROM public.wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  v_ledger := public.wallet_ledger_net(p_wallet_id, v_env);
  RETURN jsonb_build_object(
    'wallet_id', p_wallet_id, 'environment', v_env,
    'stored_balance', CASE WHEN v_env='development' THEN v_w.test_balance ELSE v_w.balance END,
    'ledger_balance', v_ledger,
    'drift', (CASE WHEN v_env='development' THEN v_w.test_balance ELSE v_w.balance END) - v_ledger,
    'payout_frozen', v_w.payout_frozen, 'payout_frozen_reason', v_w.payout_frozen_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_vendor_wallet_correction_internal(
  p_wallet_id uuid, p_expected_drift numeric, p_reason text, p_actor_id uuid, p_actor_label text, p_auth_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_env text := get_platform_environment();
  v_is_test boolean := (v_env = 'development');
  v_before record;
  v_after record;
  v_stored numeric;
  v_ledger numeric;
  v_drift numeric;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A written reason is required';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id AND wallet_type = 'vendor' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vendor wallet not found'; END IF;

  v_stored := CASE WHEN v_is_test THEN COALESCE(v_before.test_balance,0) ELSE COALESCE(v_before.balance,0) END;
  v_ledger := public.wallet_ledger_net(p_wallet_id, v_env);
  v_drift := v_stored - v_ledger;
  IF abs(v_drift - COALESCE(p_expected_drift, -999999999)) > 0.01 THEN
    RAISE EXCEPTION 'Drift changed since review (now %). Refresh and confirm again.', v_drift;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'on', true);
  IF v_is_test THEN
    UPDATE public.wallets SET test_balance = v_ledger, updated_at = now() WHERE id = p_wallet_id;
  ELSE
    UPDATE public.wallets SET balance = v_ledger, updated_at = now() WHERE id = p_wallet_id;
  END IF;
  UPDATE public.wallets SET payout_frozen = false, payout_frozen_reason = NULL, payout_frozen_at = NULL WHERE id = p_wallet_id;
  PERFORM public.reconcile_vendor_wallet(p_wallet_id);
  PERFORM set_config('app.bypass_balance_trigger', 'off', true);

  SELECT * INTO v_after FROM public.wallets WHERE id = p_wallet_id;

  INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
  VALUES (p_wallet_id, 'vendor', v_env, v_ledger, v_ledger, 0);

  INSERT INTO public.admin_sensitive_audit (
    correlation_id, actor_id, actor_name, action, category, target_type, target_id, target_label,
    old_value, new_value, amount, currency, environment, reference, reason, outcome, auth_method
  ) VALUES (
    gen_random_uuid(), p_actor_id, p_actor_label, 'vendor_wallet_reconcile', 'financial',
    'wallet', p_wallet_id::text, 'Vendor wallet',
    jsonb_build_object('balance', v_before.balance, 'eligible_balance', v_before.eligible_balance,
      'menu_earnings_balance', v_before.menu_earnings_balance, 'menu_earnings_pending', v_before.menu_earnings_pending,
      'pending_balance', v_before.pending_balance, 'rider_revenue_balance', v_before.rider_revenue_balance,
      'ledger_balance', v_ledger, 'drift', v_drift, 'payout_frozen', v_before.payout_frozen),
    jsonb_build_object('balance', v_after.balance, 'eligible_balance', v_after.eligible_balance,
      'menu_earnings_balance', v_after.menu_earnings_balance, 'menu_earnings_pending', v_after.menu_earnings_pending,
      'pending_balance', v_after.pending_balance, 'rider_revenue_balance', v_after.rider_revenue_balance,
      'ledger_balance', v_ledger, 'drift', 0, 'payout_frozen', v_after.payout_frozen),
    v_drift, 'NGN', v_env,
    'VENDOR-RECONCILE-' || p_wallet_id::text || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
    p_reason, 'success', p_auth_method
  );

  RETURN jsonb_build_object('wallet_id', p_wallet_id, 'drift_cleared', v_drift,
    'balance', v_after.balance, 'eligible_balance', v_after.eligible_balance,
    'menu_earnings_balance', v_after.menu_earnings_balance, 'pending_balance', v_after.pending_balance);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_vendor_wallet_correction_internal(uuid, numeric, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_vendor_wallet_correction_internal(uuid, numeric, text, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_correct_vendor_wallet_drift(
  p_step_up_token text, p_wallet_id uuid, p_expected_drift numeric, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  PERFORM public.consume_admin_step_up(p_step_up_token, 'vendor_wallet_reconcile', 'wallet', p_wallet_id::text);
  RETURN public.apply_vendor_wallet_correction_internal(p_wallet_id, p_expected_drift, p_reason, v_actor, NULL, 'step_up');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_correct_vendor_wallet_drift(text, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_vendor_wallet_drift(text, uuid, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_vendor_wallet_drift_preview(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vendor_wallet_drift_preview(uuid, text) TO authenticated, service_role;
