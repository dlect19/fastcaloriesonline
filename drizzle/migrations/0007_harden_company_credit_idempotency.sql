CREATE OR REPLACE FUNCTION public.admin_credit_company_account(p_amount numeric, p_category text, p_reason text, p_reference text, p_step_up_token text, p_external_reference text DEFAULT NULL::text, p_environment text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_allowed text[] := ARRAY[
    'founder_capital',
    'shareholder_loan',
    'investor_funding',
    'operating_income_adjustment',
    'refund_recovery',
    'company_credit_adjustment'
  ];
  v_financing text[] := ARRAY['founder_capital','shareholder_loan','investor_funding'];
  v_existing public.wallet_transactions;
  v_before numeric;
  v_after numeric;
  v_tx uuid;
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF p_category IS NULL OR NOT (p_category = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Unsupported company credit category';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Please provide a reason of at least 5 characters';
  END IF;

  IF p_reference IS NULL OR length(btrim(p_reference)) < 12 THEN
    RAISE EXCEPTION 'A unique posting reference is required';
  END IF;

  IF v_env NOT IN ('production','development') THEN
    RAISE EXCEPTION 'Invalid environment';
  END IF;

  SELECT * INTO v_existing
  FROM public.wallet_transactions
  WHERE wallet_type = 'platform' AND reference = btrim(p_reference)
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    -- Only a genuinely identical retry may return success; anything else is a reference clash.
    IF v_existing.transaction_type = 'credit'
       AND v_existing.amount = p_amount
       AND v_existing.category = p_category
       AND COALESCE(v_existing.environment,'') = v_env THEN
      RETURN jsonb_build_object(
        'transaction_id', v_existing.id,
        'reference', v_existing.reference,
        'amount', v_existing.amount,
        'balance_after', v_existing.balance_after,
        'already_posted', true
      );
    END IF;
    RAISE EXCEPTION 'Posting reference already used by a different company ledger entry';
  END IF;

  PERFORM public.consume_admin_step_up(p_step_up_token, 'wallet_credit', 'platform_wallet', NULL);

  SELECT CASE WHEN v_env = 'development' THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_before FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  v_tx := public.post_platform_entry(
    p_amount,
    p_category,
    'credit',
    btrim(p_reference),
    v_env,
    'completed',
    NULL,
    btrim(p_reason),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'admin_credit_company_account',
      'posted_by', v_actor,
      'external_reference', NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
      'is_financing_inflow', (p_category = ANY(v_financing))
    )
  );

  SELECT CASE WHEN v_env = 'development' THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_after FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  INSERT INTO public.admin_sensitive_audit (
    correlation_id, actor_id, action, category, target_type, target_id, target_label,
    old_value, new_value, amount, currency, environment, reference, reason, outcome, auth_method
  ) VALUES (
    gen_random_uuid(), v_actor, 'manual_company_credit', 'financial',
    'platform_wallet', v_tx::text, p_category,
    jsonb_build_object('wallet_cash_balance', v_before),
    jsonb_build_object(
      'wallet_cash_balance', v_after,
      'transaction_type', 'credit',
      'external_reference', NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
      'is_financing_inflow', (p_category = ANY(v_financing))
    ),
    p_amount, 'NGN', v_env, btrim(p_reference), btrim(p_reason), 'success', 'totp_step_up'
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'reference', btrim(p_reference),
    'amount', p_amount,
    'balance_after', v_after,
    'already_posted', false,
    'accounting_position', (
      SELECT COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0)
      FROM public.wallet_transactions
      WHERE wallet_type='platform' AND status='completed' AND environment = v_env
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) TO service_role;