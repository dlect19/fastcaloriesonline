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

    -- History-only cutover entry: aligns the ledger with the recorded balance
    -- WITHOUT touching the company balance itself.
    INSERT INTO public.wallet_transactions (
      wallet_id, wallet_type, transaction_type, category, amount,
      balance_after, reference, status, environment, notes, metadata
    ) VALUES (
      NULL, 'platform',
      CASE WHEN v_diff > 0 THEN 'credit' ELSE 'debit' END,
      'opening_balance', abs(v_diff), v_bal,
      'PLATFORM-CUTOVER-' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'completed', v_env,
      'Platform ledger cutover: aligning history with recorded company balance',
      jsonb_build_object('recorded_balance', v_bal, 'ledger_before', v_ledger)
    );
  END IF;

  RETURN QUERY SELECT v_bal, v_bal - v_diff, v_diff;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_platform_wallet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_platform_wallet(text) TO service_role;