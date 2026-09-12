-- Widen manual company credit classifications and make the accounting summary
-- classify credits by explicit whitelists instead of "everything is income".

CREATE OR REPLACE FUNCTION public.admin_credit_company_account(
  p_amount numeric,
  p_category text,
  p_reason text,
  p_reference text,
  p_step_up_token text,
  p_external_reference text DEFAULT NULL::text,
  p_environment text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
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
    'refund_recovery',
    'other_operating_income',
    'manual_adjustment',
    'other',
    -- legacy names kept accepted so older clients keep working
    'operating_income_adjustment',
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

  IF p_category = 'other' AND length(btrim(COALESCE(p_reason,''))) < 15 THEN
    RAISE EXCEPTION 'Credits recorded as "Other" need a fuller explanation (at least 15 characters)';
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
    RETURN jsonb_build_object(
      'transaction_id', v_existing.id,
      'reference', v_existing.reference,
      'classification', v_existing.category,
      'amount', v_existing.amount,
      'balance_after', v_existing.balance_after,
      'already_posted', true
    );
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
      'source', 'manual_company_credit',
      'classification', p_category,
      'reason', btrim(p_reason),
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
      'classification', p_category,
      'external_reference', NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
      'is_financing_inflow', (p_category = ANY(v_financing))
    ),
    p_amount, 'NGN', v_env, btrim(p_reference), btrim(p_reason), 'success', 'totp_step_up'
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'reference', btrim(p_reference),
    'classification', p_category,
    'amount', p_amount,
    'balance_before', v_before,
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

REVOKE EXECUTE ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_credit_company_account(numeric, text, text, text, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_accounting_summary(p_environment text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean := (v_env = 'development');
  v_financing text[] := ARRAY['founder_capital','shareholder_loan','investor_funding'];
  v_revenue text[] := ARRAY['platform_commission','delivery_commission','service_fee','other_operating_income','operating_income_adjustment'];
  v_recovery text[] := ARRAY['refund_recovery','manual_adjustment','company_credit_adjustment','other'];
  v_stored numeric := 0;
  v_ledger numeric := 0;
  v_operating_income numeric := 0;
  v_financing_inflows numeric := 0;
  v_recoveries numeric := 0;
  v_unclassified numeric := 0;
  v_bookkeeping numeric := 0;
  v_expenses numeric := 0;
  v_pending_payouts numeric := 0;
  v_by_category jsonb;
  v_financing_by_category jsonb;
BEGIN
  IF v_actor IS NOT NULL
     AND NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_stored FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  SELECT
    COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0),
    COALESCE(SUM(CASE WHEN transaction_type='credit' AND category = ANY(v_revenue) THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN category = ANY(v_financing)
                      THEN CASE WHEN transaction_type='credit' THEN amount ELSE -amount END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN category = ANY(v_recovery)
                      THEN CASE WHEN transaction_type='credit' THEN amount ELSE -amount END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN transaction_type='credit'
                       AND category <> 'opening_balance'
                       AND NOT (category = ANY(v_revenue))
                       AND NOT (category = ANY(v_financing))
                       AND NOT (category = ANY(v_recovery))
                      THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN category = 'opening_balance'
                      THEN CASE WHEN transaction_type='credit' THEN amount ELSE -amount END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN transaction_type='debit'
                       AND NOT (category = ANY(v_financing))
                       AND NOT (category = ANY(v_recovery))
                      THEN amount ELSE 0 END),0)
  INTO v_ledger, v_operating_income, v_financing_inflows, v_recoveries, v_unclassified, v_bookkeeping, v_expenses
  FROM public.wallet_transactions
  WHERE wallet_type='platform' AND status='completed' AND environment = v_env;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'total')::numeric DESC), '[]'::jsonb) INTO v_by_category
  FROM (
    SELECT jsonb_build_object(
             'category', category,
             'transaction_type', transaction_type,
             'entries', COUNT(*),
             'total', SUM(amount)
           ) AS x
    FROM public.wallet_transactions
    WHERE wallet_type='platform' AND status='completed' AND environment = v_env
    GROUP BY category, transaction_type
  ) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'total')::numeric DESC), '[]'::jsonb)
  INTO v_financing_by_category
  FROM (
    SELECT jsonb_build_object(
             'category', category,
             'entries', COUNT(*),
             'total', SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END)
           ) AS x
    FROM public.wallet_transactions
    WHERE wallet_type='platform' AND status='completed' AND environment = v_env
      AND category = ANY(v_financing)
    GROUP BY category
  ) f;

  SELECT COALESCE(SUM(amount),0) INTO v_pending_payouts
  FROM public.payout_requests
  WHERE status IN ('pending','processing') AND COALESCE(environment, 'production') = v_env;

  RETURN jsonb_build_object(
    'environment', v_env,
    'accounting_position', v_ledger,
    'operating_income', v_operating_income,
    'operating_result', v_operating_income - v_expenses,
    'financing_inflows', v_financing_inflows,
    'capital_and_financing_inflows', v_financing_inflows,
    'recoveries_and_adjustments', v_recoveries,
    'other_unclassified_credits', v_unclassified,
    'financing_by_category', v_financing_by_category,
    'bookkeeping_entries', v_bookkeeping,
    'total_expenses', v_expenses,
    'deficit', CASE WHEN v_ledger < 0 THEN -v_ledger ELSE 0 END,
    'wallet_cash_balance', v_stored,
    'pending_payouts', v_pending_payouts,
    'withdrawable_surplus', GREATEST(0, LEAST(v_stored - v_pending_payouts, v_ledger)),
    'ledger_drift', v_stored - v_ledger,
    'by_category', v_by_category
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.platform_accounting_summary(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounting_summary(text) TO authenticated, service_role;