-- 1) Deterministic idempotency for platform ledger references (verified: 0 existing duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_wallet_tx_reference
  ON public.wallet_transactions (reference)
  WHERE wallet_type = 'platform' AND reference IS NOT NULL;

-- 2) Convert direct platform_wallet writers to post_platform_entry (surgical, verified rewrites)
DO $mig$
DECLARE d text;
BEGIN
  ---------------------------------------------------------------- credit_vendor_on_payment
  d := pg_get_functiondef('public.credit_vendor_on_payment'::regproc);
  d := regexp_replace(d,
    'IF v_is_test THEN\s+UPDATE platform_wallet SET test_balance = COALESCE\(test_balance, 0\) \+ v_company_revenue[\s\S]*?''PLATFORM-COMMISSION-'' \|\| NEW\.id::text\s*\);',
'PERFORM public.post_platform_entry(
        v_company_revenue, ''platform_commission'', ''credit'',
        ''PLATFORM-COMMISSION-'' || NEW.id::text, NEW.environment, ''completed'', NEW.id,
        ''Commission + service fee for order #'' || NEW.order_number,
        jsonb_build_object(''source'', ''credit_vendor_on_payment''));
      PERFORM set_config(''app.bypass_balance_trigger'', ''true'', true);', 'g');
  IF d LIKE '%UPDATE platform_wallet%' OR d NOT LIKE '%post_platform_entry%' THEN
    RAISE EXCEPTION 'credit_vendor_on_payment rewrite failed';
  END IF;
  EXECUTE d;

  ---------------------------------------------------------------- credit_rider_on_assignment
  d := pg_get_functiondef('public.credit_rider_on_assignment'::regproc);
  d := regexp_replace(d,
    'IF v_is_test THEN\s+UPDATE platform_wallet SET test_balance = COALESCE\(test_balance, 0\) \+ v_platform_delivery_share[\s\S]*?''PLATFORM-DELIVERY-'' \|\| NEW\.id::text\);',
'PERFORM public.post_platform_entry(
          v_platform_delivery_share, ''delivery_commission'', ''credit'',
          ''PLATFORM-DELIVERY-'' || NEW.id::text, NEW.environment, ''completed'', NEW.id,
          ''Delivery commission from order #'' || NEW.order_number,
          jsonb_build_object(''source'', ''credit_rider_on_assignment''));
        PERFORM set_config(''app.bypass_balance_trigger'', ''true'', true);', 'g');
  IF d LIKE '%UPDATE platform_wallet%' OR d NOT LIKE '%post_platform_entry%' THEN
    RAISE EXCEPTION 'credit_rider_on_assignment rewrite failed';
  END IF;
  EXECUTE d;

  ---------------------------------------------------------------- reverse_financials_on_cancellation
  d := pg_get_functiondef('public.reverse_financials_on_cancellation'::regproc);

  -- (a) remove the company zero-clamp branch; company reversal is posted below and may go negative
  d := regexp_replace(d,
    'WHEN ''platform_commission'', ''service_fee'', ''delivery_commission'' THEN[\s\S]*?END IF;',
'WHEN ''platform_commission'', ''service_fee'', ''delivery_commission'' THEN
          NULL; -- company reversal posted via post_platform_entry below (never clamped to zero)', 'g');

  -- (b) promo cost return -> authoritative company credit
  d := regexp_replace(d,
    'IF v_is_test THEN\s+UPDATE platform_wallet SET\s+test_balance = COALESCE\(test_balance, 0\) \+ v_tx\.amount[\s\S]*?''Reversal - Promo cost returned, Order #'' \|\| v_order_number \|\| '' cancelled''\s*\);',
'PERFORM public.post_platform_entry(
        v_tx.amount, ''promo_cost'', ''credit'',
        ''PLATFORM-PROMO-REV-'' || v_tx.id::text, v_tx.environment, ''completed'', NEW.id,
        ''Reversal - Promo cost returned, Order #'' || v_order_number || '' cancelled'',
        jsonb_build_object(''source'', ''reverse_financials_on_cancellation'', ''original_transaction_id'', v_tx.id));
      PERFORM set_config(''app.bypass_balance_trigger'', ''true'', true);', 'g');

  -- (c) generic reversal entry: company rows go through post_platform_entry (balance_after + idempotency)
  d := regexp_replace(d,
    'INSERT INTO wallet_transactions \(\s*wallet_type, category, transaction_type, amount, order_id,\s*wallet_id, platform_wallet_id, environment, status, notes\s*\) VALUES \([\s\S]*?''Reversal - Order #'' \|\| v_order_number \|\| '' cancelled''\s*\);',
'IF v_tx.wallet_type = ''platform'' THEN
        PERFORM public.post_platform_entry(
          v_tx.amount, v_tx.category, ''debit'',
          ''PLATFORM-REVERSAL-'' || v_tx.id::text, v_tx.environment, ''completed'', NEW.id,
          ''Reversal - Order #'' || v_order_number || '' cancelled'',
          jsonb_build_object(''source'', ''reverse_financials_on_cancellation'', ''original_transaction_id'', v_tx.id));
        PERFORM set_config(''app.bypass_balance_trigger'', ''true'', true);
      ELSE
        INSERT INTO wallet_transactions (
          wallet_type, category, transaction_type, amount, order_id,
          wallet_id, platform_wallet_id, environment, status, notes
        ) VALUES (
          v_tx.wallet_type, v_tx.category, ''debit'', v_tx.amount, NEW.id,
          v_tx.wallet_id, v_tx.platform_wallet_id, v_tx.environment, ''completed'',
          ''Reversal - Order #'' || v_order_number || '' cancelled''
        );
      END IF;', 'g');

  IF d LIKE '%UPDATE platform_wallet%'
     OR d NOT LIKE '%PLATFORM-REVERSAL-%'
     OR d NOT LIKE '%PLATFORM-PROMO-REV-%' THEN
    RAISE EXCEPTION 'reverse_financials_on_cancellation rewrite failed';
  END IF;
  EXECUTE d;

  ---------------------------------------------------------------- adjust_vendor_payout_after_refund
  d := pg_get_functiondef('public.adjust_vendor_payout_after_refund'::regproc);
  d := regexp_replace(d,
    'IF v_is_test THEN\s+UPDATE platform_wallet SET test_balance = COALESCE\(test_balance,0\) \+ v_pc_delta[\s\S]*?WHERE id = v_pc_tx\.id;',
'PERFORM public.post_platform_entry(
        ABS(v_pc_delta), ''refund_adjustment'',
        CASE WHEN v_pc_delta < 0 THEN ''debit'' ELSE ''credit'' END,
        ''PLATFORM-REFUND-ADJ-'' || v_pc_tx.id::text, v_order.environment, ''completed'', p_order_id,
        ''Company revenue adjustment after refund for order #'' || v_order.order_number ||
        '' (was NGN '' || v_pc_tx.amount || '', now NGN '' || v_new_company_revenue || '')'',
        jsonb_build_object(''source'', ''adjust_vendor_payout_after_refund'',
                           ''original_transaction_id'', v_pc_tx.id,
                           ''new_company_revenue'', v_new_company_revenue));
      PERFORM set_config(''app.bypass_balance_trigger'', ''true'', true);', 'g');
  IF d LIKE '%UPDATE platform_wallet%' OR d NOT LIKE '%PLATFORM-REFUND-ADJ-%' THEN
    RAISE EXCEPTION 'adjust_vendor_payout_after_refund rewrite failed';
  END IF;
  EXECUTE d;
END
$mig$;

-- 3) Reconciliation reports drift, never manufactures opening-balance history
CREATE OR REPLACE FUNCTION public.reconcile_platform_wallet(p_environment text DEFAULT NULL::text)
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
  FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  IF v_pw_id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
  INTO v_ledger
  FROM public.wallet_transactions
  WHERE wallet_type = 'platform' AND status = 'completed' AND environment = v_env;

  v_diff := v_bal - v_ledger;

  -- Report only: record the finding, do NOT self-heal by inventing ledger history.
  IF abs(v_diff) > 0.01 THEN
    INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
    VALUES (NULL, 'platform', v_env, v_bal, v_ledger, v_diff);
  END IF;

  RETURN QUERY SELECT v_ledger, v_bal, v_diff;
END;
$function$;

-- 4) Atomic, idempotent expense completion shared by manual and Paystack paths
CREATE OR REPLACE FUNCTION public.finalize_expense_payment(
  p_requisition_id uuid,
  p_payment_method text,
  p_payment_note text DEFAULT NULL,
  p_paystack_reference text DEFAULT NULL,
  p_transfer_code text DEFAULT NULL,
  p_paid_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_req RECORD;
  v_tx_id uuid;
  v_balance numeric;
BEGIN
  IF v_actor IS NOT NULL
     AND NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only admins can complete expense payments';
  END IF;

  SELECT * INTO v_req FROM public.expense_requisitions
   WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense requisition not found';
  END IF;

  IF v_req.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Expense requisition must be approved before payment (current status: %)', v_req.status;
  END IF;

  IF v_req.status = 'approved' THEN
    UPDATE public.expense_requisitions SET
      status = 'paid',
      payment_method = COALESCE(p_payment_method, payment_method),
      payment_note = COALESCE(p_payment_note, payment_note),
      paystack_reference = COALESCE(p_paystack_reference, paystack_reference),
      paystack_transfer_code = COALESCE(p_transfer_code, paystack_transfer_code),
      paid_at = NOW(),
      paid_by = COALESCE(p_paid_by, v_actor, paid_by),
      updated_at = NOW()
    WHERE id = p_requisition_id;
  END IF;

  -- Idempotent by deterministic reference: retries never double-post.
  v_tx_id := public.post_platform_entry(
    v_req.amount, 'expense', 'debit',
    'EXP-' || p_requisition_id::text,
    v_req.environment, 'completed', NULL,
    'Expense: ' || v_req.title,
    jsonb_build_object(
      'requisition_id', p_requisition_id,
      'expense_category', v_req.category,
      'payment_method', COALESCE(p_payment_method, v_req.payment_method),
      'paystack_reference', COALESCE(p_paystack_reference, v_req.paystack_reference),
      'source', 'finalize_expense_payment'
    )
  );

  SELECT CASE WHEN v_req.environment = 'development'
              THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_balance FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  RETURN jsonb_build_object(
    'requisition_id', p_requisition_id,
    'already_paid', (v_req.status = 'paid'),
    'amount', v_req.amount,
    'transaction_id', v_tx_id,
    'company_balance_after', v_balance
  );
END;
$function$;

-- 5) Company accounting summary (ledger is the source of truth; deficits allowed)
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
  v_stored numeric := 0;
  v_ledger numeric := 0;
  v_operating_income numeric := 0;
  v_bookkeeping numeric := 0;
  v_expenses numeric := 0;
  v_pending_payouts numeric := 0;
  v_by_category jsonb;
BEGIN
  IF v_actor IS NOT NULL
     AND NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_stored FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  SELECT
    COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0),
    COALESCE(SUM(CASE WHEN transaction_type='credit' AND category <> 'opening_balance' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN category = 'opening_balance'
                      THEN CASE WHEN transaction_type='credit' THEN amount ELSE -amount END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN transaction_type='debit' THEN amount ELSE 0 END),0)
  INTO v_ledger, v_operating_income, v_bookkeeping, v_expenses
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

  SELECT COALESCE(SUM(amount),0) INTO v_pending_payouts
  FROM public.payout_requests
  WHERE status IN ('pending','processing') AND COALESCE(environment, 'production') = v_env;

  RETURN jsonb_build_object(
    'environment', v_env,
    'accounting_position', v_ledger,
    'operating_income', v_operating_income,
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

-- 6) Read-only reconciliation review surface (no repair)
CREATE OR REPLACE FUNCTION public.platform_reconciliation_report(p_environment text DEFAULT NULL::text)
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
  v_stored numeric := 0;
  v_ledger numeric := 0;
  v_cutover jsonb;
  v_audit jsonb;
BEGIN
  IF v_actor IS NOT NULL
     AND NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_stored FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  SELECT COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0)
  INTO v_ledger FROM public.wallet_transactions
  WHERE wallet_type='platform' AND status='completed' AND environment = v_env;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'amount', amount, 'transaction_type', transaction_type,
           'reference', reference, 'notes', notes, 'created_at', created_at
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_cutover FROM public.wallet_transactions
  WHERE wallet_type='platform' AND category='opening_balance' AND environment = v_env;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'wallet_balance', wallet_balance, 'ledger_balance', ledger_balance,
           'drift', drift, 'detected_at', created_at
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_audit FROM (
    SELECT * FROM public.wallet_drift_audit
    WHERE wallet_type='platform' AND environment = v_env
    ORDER BY created_at DESC LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'environment', v_env,
    'stored_balance', v_stored,
    'ledger_balance', v_ledger,
    'drift', v_stored - v_ledger,
    'recommended_correction', v_ledger - v_stored,
    'cutover_entries', v_cutover,
    'recent_drift_audit', v_audit
  );
END;
$function$;

-- 7) Explicit, step-up protected, audited one-time drift correction (never auto-invoked)
CREATE OR REPLACE FUNCTION public.admin_apply_platform_reconciliation(
  p_step_up_token text,
  p_expected_drift numeric,
  p_reason text,
  p_environment text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean := (v_env = 'development');
  v_pw_id uuid;
  v_stored numeric := 0;
  v_ledger numeric := 0;
  v_drift numeric := 0;
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A written reason is required for a company balance correction';
  END IF;

  PERFORM public.consume_admin_step_up(p_step_up_token, 'platform_balance_reconciliation', 'platform_wallet', NULL);

  SELECT id, CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_pw_id, v_stored
  FROM public.platform_wallet ORDER BY created_at LIMIT 1 FOR UPDATE;

  SELECT COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0)
  INTO v_ledger FROM public.wallet_transactions
  WHERE wallet_type='platform' AND status='completed' AND environment = v_env;

  v_drift := v_stored - v_ledger;
  IF abs(v_drift - COALESCE(p_expected_drift, -1)) > 0.01 THEN
    RAISE EXCEPTION 'Drift changed since review (now %). Refresh and confirm again.', v_drift;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'on', true);
  IF v_is_test THEN
    UPDATE public.platform_wallet SET test_balance = v_ledger, updated_at = now() WHERE id = v_pw_id;
  ELSE
    UPDATE public.platform_wallet SET balance = v_ledger, updated_at = now() WHERE id = v_pw_id;
  END IF;
  PERFORM set_config('app.bypass_balance_trigger', 'off', true);

  INSERT INTO public.wallet_drift_audit (wallet_id, wallet_type, environment, wallet_balance, ledger_balance, drift)
  VALUES (NULL, 'platform', v_env, v_ledger, v_ledger, 0);

  INSERT INTO public.admin_sensitive_audit (
    correlation_id, actor_id, action, category, target_type, target_id, target_label,
    old_value, new_value, amount, currency, environment, reference, reason, outcome, auth_method
  ) VALUES (
    gen_random_uuid(), v_actor, 'platform_balance_reconciliation', 'financial',
    'platform_wallet', v_pw_id::text, 'Company wallet',
    jsonb_build_object('stored_balance', v_stored, 'ledger_balance', v_ledger, 'drift', v_drift),
    jsonb_build_object('stored_balance', v_ledger, 'ledger_balance', v_ledger, 'drift', 0),
    v_drift, 'NGN', v_env,
    'PLATFORM-RECONCILE-' || to_char(now(), 'YYYYMMDDHH24MISS'),
    p_reason, 'success', 'step_up'
  );

  RETURN jsonb_build_object(
    'previous_stored_balance', v_stored,
    'new_stored_balance', v_ledger,
    'drift_cleared', v_drift
  );
END;
$function$;

-- 8) Grants: company money posting stays server-side; reports/actions are guarded admin RPCs
REVOKE EXECUTE ON FUNCTION public.post_platform_entry(numeric, text, text, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_platform_entry(numeric, text, text, text, text, text, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_expense_payment(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_expense_payment(uuid, text, text, text, text, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.platform_accounting_summary(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounting_summary(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.platform_reconciliation_report(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_reconciliation_report(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_apply_platform_reconciliation(text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_platform_reconciliation(text, numeric, text, text) TO authenticated;
