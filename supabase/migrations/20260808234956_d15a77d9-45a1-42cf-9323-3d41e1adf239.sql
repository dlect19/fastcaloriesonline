-- 1) Lock down direct balance edits on wallets
REVOKE UPDATE ON public.wallets FROM authenticated;
REVOKE UPDATE ON public.wallets FROM anon;
GRANT UPDATE (
  bank_name, bank_account_number, bank_account_name,
  auto_withdraw, auto_withdraw_threshold, auto_withdraw_day,
  paystack_recipient_code, paystack_customer_id, paystack_customer_code,
  dva_bank_name, dva_account_number, dva_account_name, dva_active, dva_created_at,
  updated_at
) ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;

-- 2) Company account: no direct app-user writes at all
REVOKE UPDATE, INSERT, DELETE ON public.platform_wallet FROM authenticated;
REVOKE UPDATE, INSERT, DELETE ON public.platform_wallet FROM anon;
GRANT ALL ON public.platform_wallet TO service_role;

-- 3) Admin reconciliation report
CREATE OR REPLACE FUNCTION public.admin_financial_reconciliation(
  p_from timestamptz DEFAULT (now() - interval '30 days'),
  p_to timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'wallet_flows', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'type', COALESCE(type, 'unknown'),
          'count', count(*),
          'credits', COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
          'debits', COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0),
          'net', COALESCE(SUM(amount), 0)
        ) AS x
        FROM public.wallet_transactions
        WHERE created_at >= p_from AND created_at < p_to
        GROUP BY COALESCE(type, 'unknown')
      ) s
    ),
    'wallet_totals', (
      SELECT jsonb_build_object(
        'credits', COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
        'debits', COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0),
        'net', COALESCE(SUM(amount), 0),
        'entries', count(*)
      )
      FROM public.wallet_transactions
      WHERE created_at >= p_from AND created_at < p_to
    ),
    'liabilities', (
      SELECT COALESCE(jsonb_agg(y ORDER BY y->>'wallet_type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'wallet_type', COALESCE(wallet_type, 'customer'),
          'wallets', count(*),
          'balance', COALESCE(SUM(balance), 0),
          'pending', COALESCE(SUM(pending_balance), 0),
          'eligible', COALESCE(SUM(eligible_balance), 0)
        ) AS y
        FROM public.wallets
        GROUP BY COALESCE(wallet_type, 'customer')
      ) t
    ),
    'company', (
      SELECT jsonb_build_object(
        'balance', COALESCE(pw.balance, 0),
        'total_earned', COALESCE(pw.total_earned, 0),
        'total_paid_out', COALESCE(pw.total_paid_out, 0)
      )
      FROM public.platform_wallet pw LIMIT 1
    ),
    'company_flows', (
      SELECT COALESCE(jsonb_agg(z ORDER BY z->>'type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'type', COALESCE(t.type, 'unknown'),
          'count', count(*),
          'net', COALESCE(SUM(t.amount), 0)
        ) AS z
        FROM public.transactions t
        WHERE t.created_at >= p_from AND t.created_at < p_to
        GROUP BY COALESCE(t.type, 'unknown')
      ) c
    ),
    'payouts', (
      SELECT jsonb_build_object(
        'requested', COALESCE(SUM(amount), 0),
        'count', count(*),
        'by_status', COALESCE((
          SELECT jsonb_object_agg(status, cnt) FROM (
            SELECT status, count(*) AS cnt
            FROM public.payout_requests
            WHERE created_at >= p_from AND created_at < p_to
            GROUP BY status
          ) q
        ), '{}'::jsonb)
      )
      FROM public.payout_requests
      WHERE created_at >= p_from AND created_at < p_to
    ),
    'drift', (
      SELECT jsonb_build_object(
        'wallets_checked', count(*),
        'total_drift', COALESCE(SUM(w.balance - COALESCE(l.ledger, 0)), 0),
        'wallets_with_drift', COUNT(*) FILTER (WHERE ABS(w.balance - COALESCE(l.ledger, 0)) > 0.009)
      )
      FROM public.wallets w
      LEFT JOIN (
        SELECT wallet_id, SUM(amount) AS ledger
        FROM public.wallet_transactions
        GROUP BY wallet_id
      ) l ON l.wallet_id = w.id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_reconciliation(timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_financial_reconciliation(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_reconciliation(timestamptz, timestamptz) TO service_role;