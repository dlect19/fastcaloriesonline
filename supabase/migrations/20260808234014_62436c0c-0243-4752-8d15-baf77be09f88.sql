-- 1. Drift audit: support platform wallet rows
ALTER TABLE public.wallet_drift_audit ADD COLUMN IF NOT EXISTS wallet_type text NOT NULL DEFAULT 'user';
ALTER TABLE public.wallet_drift_audit ALTER COLUMN wallet_id DROP NOT NULL;

-- 2. Safe platform (company) money posting
CREATE OR REPLACE FUNCTION public.post_platform_entry(
  p_transaction_type text,
  p_category text,
  p_amount numeric,
  p_reference text,
  p_environment text DEFAULT 'production',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT 'completed'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_delta numeric;
  v_is_test boolean := (p_environment = 'development');
  v_tx_id uuid;
  v_balance_after numeric;
  v_pw_id uuid;
BEGIN
  IF p_reference IS NULL OR length(trim(p_reference)) = 0 THEN
    RAISE EXCEPTION 'post_platform_entry: p_reference is required for idempotency';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'post_platform_entry: p_amount must be positive';
  END IF;
  IF p_transaction_type NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'post_platform_entry: p_transaction_type must be credit or debit';
  END IF;

  SELECT id INTO v_pw_id FROM public.platform_wallet ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_pw_id IS NULL THEN
    INSERT INTO public.platform_wallet (balance, test_balance, total_earned, total_paid_out)
    VALUES (0,0,0,0) RETURNING id INTO v_pw_id;
  END IF;

  SELECT id INTO v_existing
  FROM public.wallet_transactions
  WHERE wallet_type = 'platform' AND reference = p_reference
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_delta := CASE WHEN p_transaction_type = 'credit' THEN p_amount ELSE -p_amount END;

  IF p_status = 'completed' THEN
    IF v_is_test THEN
      UPDATE public.platform_wallet
      SET test_balance = COALESCE(test_balance,0) + v_delta, updated_at = now()
      WHERE id = v_pw_id RETURNING test_balance INTO v_balance_after;
    ELSE
      UPDATE public.platform_wallet
      SET balance = COALESCE(balance,0) + v_delta,
          total_earned = COALESCE(total_earned,0) + GREATEST(v_delta,0),
          total_paid_out = COALESCE(total_paid_out,0) + GREATEST(-v_delta,0),
          updated_at = now()
      WHERE id = v_pw_id RETURNING balance INTO v_balance_after;
    END IF;
  ELSE
    SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
    INTO v_balance_after FROM public.platform_wallet WHERE id = v_pw_id;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount,
    balance_after, reference, order_id, status, environment, notes, metadata
  ) VALUES (
    NULL, 'platform', p_transaction_type, p_category, p_amount,
    v_balance_after, p_reference, p_order_id, p_status, p_environment, p_notes,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_platform_entry(text,text,numeric,text,text,uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_platform_entry(text,text,numeric,text,text,uuid,text,jsonb,text) TO service_role;

-- 3. Platform balance reconciliation (ledger is truth)
CREATE OR REPLACE FUNCTION public.reconcile_platform_wallet(p_environment text DEFAULT NULL)
RETURNS TABLE(ledger_balance numeric, previous_balance numeric, correction numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean := (v_env = 'development');
  v_pw_id uuid;
  v_ledger numeric := 0;
  v_bal numeric := 0;
  v_diff numeric := 0;
BEGIN
  SELECT id, CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_pw_id, v_bal
  FROM public.platform_wallet ORDER BY created_at LIMIT 1 FOR UPDATE;

  IF v_pw_id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
  INTO v_ledger
  FROM public.wallet_transactions
  WHERE wallet_type = 'platform' AND status = 'completed' AND environment = v_env;

  v_diff := v_bal - v_ledger;

  IF abs(v_diff) > 0.01 THEN
    INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
    VALUES (NULL, 'platform', v_env, v_bal, v_ledger, v_diff);

    PERFORM public.post_platform_entry(
      CASE WHEN v_diff > 0 THEN 'credit' ELSE 'debit' END,
      'opening_balance',
      abs(v_diff),
      'PLATFORM-CUTOVER-' || to_char(now(), 'YYYYMMDDHH24MISS'),
      v_env,
      NULL,
      'Platform ledger cutover: aligning ledger with recorded company balance',
      jsonb_build_object('previous_balance', v_bal, 'ledger_before', v_ledger)
    );
  END IF;

  RETURN QUERY SELECT v_ledger, v_bal, v_diff;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_platform_wallet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_platform_wallet(text) TO service_role;

-- 4. Drift detector now covers the platform wallet too
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
  WITH led AS (
    SELECT wallet_id,
           SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS ledger
    FROM public.wallet_transactions
    WHERE status = 'completed' AND environment = v_env AND wallet_id IS NOT NULL
    GROUP BY wallet_id
  ), calc AS (
    SELECT w.id,
           CASE WHEN v_is_test THEN COALESCE(w.test_balance,0) ELSE COALESCE(w.balance,0) END AS bal,
           COALESCE(l.ledger,0) AS ledger
    FROM public.wallets w
    LEFT JOIN led l ON l.wallet_id = w.id
  ), ins AS (
    INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
    SELECT id, 'user', v_env, bal, ledger, bal - ledger FROM calc
    WHERE abs(bal - ledger) > 0.01
    RETURNING drift
  )
  SELECT (SELECT count(*) FROM calc), (SELECT count(*) FROM ins), COALESCE((SELECT sum(abs(drift)) FROM ins), 0)
  INTO v_checked, v_drifted, v_total;

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

-- 5. Settlement release: all held categories + stale hold cleanup
CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  released_count INTEGER := 0;
  tx RECORD;
  v_is_test BOOLEAN;
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  FOR tx IN
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment, wt.created_at, wt.category
    FROM public.wallet_transactions wt
    WHERE wt.category IN ('vendor_share', 'vendor_rider_share', 'voucher_sale')
      AND wt.status = 'pending'
      AND wt.wallet_id IS NOT NULL
      AND public.vendor_settlement_release_at(COALESCE(wt.created_at, NOW()), wt.wallet_id) <= NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_is_test := (tx.environment = 'development');

    IF v_is_test THEN
      UPDATE public.wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - tx.amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + tx.amount,
        test_balance = COALESCE(test_balance, 0) + tx.amount,
        test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - tx.amount, 0),
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    ELSE
      UPDATE public.wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - tx.amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + tx.amount,
        balance = COALESCE(balance, 0) + tx.amount,
        menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - tx.amount, 0),
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    END IF;

    UPDATE public.wallet_transactions
    SET status = 'completed',
        balance_after = CASE
          WHEN v_is_test THEN (SELECT COALESCE(test_balance,0) FROM public.wallets WHERE id = tx.wallet_id)
          ELSE (SELECT COALESCE(balance,0) FROM public.wallets WHERE id = tx.wallet_id)
        END,
        notes = 'Released by settlement schedule',
        updated_at = NOW()
    WHERE id = tx.id;

    UPDATE public.payout_pending_releases
    SET released = TRUE, released_at = NOW(), updated_at = NOW()
    WHERE transaction_id = tx.id AND NOT released;

    released_count := released_count + 1;
  END LOOP;

  -- Close stale hold rows whose transaction is cancelled or already completed
  UPDATE public.payout_pending_releases ppr
  SET released = TRUE, released_at = NOW(), updated_at = NOW()
  FROM public.wallet_transactions wt
  WHERE wt.id = ppr.transaction_id
    AND ppr.released = FALSE
    AND wt.status IN ('completed', 'cancelled', 'reversed', 'failed');

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN released_count;
END;
$function$;

-- 6. Release matured event-organizer holds automatically
SELECT cron.schedule(
  'release-event-organizer-holds',
  '*/10 * * * *',
  $$SELECT public.release_event_organizer_matured_holds();$$
);
