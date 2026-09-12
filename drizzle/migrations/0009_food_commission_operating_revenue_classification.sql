-- Classify food_commission as explicit operating revenue in the company accounting summary.

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
  v_revenue text[] := ARRAY['platform_commission','delivery_commission','service_fee','food_commission','other_operating_income','operating_income_adjustment'];
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