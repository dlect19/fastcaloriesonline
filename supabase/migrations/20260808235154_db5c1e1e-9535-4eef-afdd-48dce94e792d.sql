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
  v_env text := get_platform_environment();
  v_is_test boolean := (get_platform_environment() = 'development');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'environment', v_env),
    'wallet_flows', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'type', COALESCE(category, 'uncategorised'),
          'count', count(*),
          'credits', COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END), 0),
          'debits', COALESCE(SUM(CASE WHEN transaction_type <> 'credit' THEN amount ELSE 0 END), 0),
          'net', COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
        ) AS x
        FROM public.wallet_transactions
        WHERE created_at >= p_from AND created_at < p_to
          AND status = 'completed' AND environment = v_env AND wallet_id IS NOT NULL
        GROUP BY COALESCE(category, 'uncategorised')
      ) s
    ),
    'wallet_totals', (
      SELECT jsonb_build_object(
        'credits', COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END), 0),
        'debits', COALESCE(SUM(CASE WHEN transaction_type <> 'credit' THEN amount ELSE 0 END), 0),
        'net', COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0),
        'entries', count(*)
      )
      FROM public.wallet_transactions
      WHERE created_at >= p_from AND created_at < p_to
        AND status = 'completed' AND environment = v_env AND wallet_id IS NOT NULL
    ),
    'liabilities', (
      SELECT COALESCE(jsonb_agg(y ORDER BY y->>'wallet_type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'wallet_type', COALESCE(wallet_type, 'customer'),
          'wallets', count(*),
          'balance', COALESCE(SUM(CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END), 0),
          'pending', COALESCE(SUM(CASE WHEN v_is_test THEN COALESCE(test_pending_balance,0) ELSE COALESCE(pending_balance,0) END), 0),
          'eligible', COALESCE(SUM(CASE WHEN v_is_test THEN COALESCE(test_eligible_balance,0) ELSE COALESCE(eligible_balance,0) END), 0)
        ) AS y
        FROM public.wallets
        GROUP BY COALESCE(wallet_type, 'customer')
      ) t
    ),
    'company', (
      SELECT jsonb_build_object(
        'balance', CASE WHEN v_is_test THEN COALESCE(pw.test_balance,0) ELSE COALESCE(pw.balance,0) END,
        'total_earned', COALESCE(pw.total_earned, 0),
        'total_paid_out', COALESCE(pw.total_paid_out, 0)
      )
      FROM public.platform_wallet pw ORDER BY pw.created_at LIMIT 1
    ),
    'company_flows', (
      SELECT COALESCE(jsonb_agg(z ORDER BY z->>'type'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'type', COALESCE(category, 'uncategorised'),
          'count', count(*),
          'net', COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END), 0)
        ) AS z
        FROM public.wallet_transactions
        WHERE created_at >= p_from AND created_at < p_to
          AND status = 'completed' AND environment = v_env AND wallet_type = 'platform'
        GROUP BY COALESCE(category, 'uncategorised')
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
        'total_drift', COALESCE(SUM(bal - ledger), 0),
        'wallets_with_drift', COUNT(*) FILTER (WHERE ABS(bal - ledger) > 0.01)
      )
      FROM (
        SELECT CASE WHEN v_is_test THEN COALESCE(w.test_balance,0) ELSE COALESCE(w.balance,0) END AS bal,
               COALESCE(l.ledger, 0) AS ledger
        FROM public.wallets w
        LEFT JOIN (
          SELECT wallet_id, SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS ledger
          FROM public.wallet_transactions
          WHERE status = 'completed' AND environment = v_env AND wallet_id IS NOT NULL
          GROUP BY wallet_id
        ) l ON l.wallet_id = w.id
      ) d
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;