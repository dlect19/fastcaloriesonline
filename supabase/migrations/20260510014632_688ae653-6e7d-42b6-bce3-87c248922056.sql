
CREATE TABLE IF NOT EXISTS public.payment_hold_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_key text NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('vendor','rider','delivery_company')),
  party_id uuid NOT NULL,
  wallet_id uuid,
  order_id uuid,
  amount numeric NOT NULL CHECK (amount >= 0),
  decision text NOT NULL CHECK (decision IN ('absorbed','released')),
  reason text NOT NULL,
  source text NOT NULL,
  resolved_by uuid,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_hold_resolutions_key
  ON public.payment_hold_resolutions(hold_key);
CREATE INDEX IF NOT EXISTS idx_phr_party
  ON public.payment_hold_resolutions(party_type, party_id, resolved_at DESC);

ALTER TABLE public.payment_hold_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read hold resolutions" ON public.payment_hold_resolutions;
CREATE POLICY "Admins read hold resolutions" ON public.payment_hold_resolutions
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins insert hold resolutions" ON public.payment_hold_resolutions;
CREATE POLICY "Admins insert hold resolutions" ON public.payment_hold_resolutions
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE VIEW public.admin_on_hold_payments
WITH (security_invoker=on) AS
WITH resolved AS (
  SELECT hold_key FROM public.payment_hold_resolutions
),
vendor_pending AS (
  SELECT
    'vendor_pending:' || w.id::text AS hold_key,
    'vendor'::text AS party_type,
    v.id AS party_id,
    v.name AS party_name,
    w.id AS wallet_id,
    NULL::uuid AS order_id,
    NULL::text AS order_number,
    COALESCE(w.pending_balance, 0)::numeric AS amount,
    'settlement_period'::text AS source,
    'Settlement-period hold (vendor menu earnings still in pending window)'::text AS reason,
    w.updated_at AS held_since
  FROM public.wallets w
  JOIN public.vendors v ON v.user_id = w.user_id
  WHERE w.wallet_type = 'vendor'
    AND COALESCE(w.pending_balance, 0) > 0
),
suspended_vendor AS (
  SELECT
    'suspended_vendor:' || v.id::text,
    'vendor'::text,
    v.id,
    v.name,
    w.id,
    NULL::uuid,
    NULL::text,
    COALESCE(w.eligible_balance, 0)::numeric,
    'suspension'::text,
    'Vendor account suspended; eligible earnings on hold'::text,
    v.updated_at
  FROM public.vendors v
  JOIN public.wallets w ON w.user_id = v.user_id AND w.wallet_type = 'vendor'
  WHERE v.is_active = false
    AND COALESCE(w.eligible_balance, 0) > 0
),
suspended_company AS (
  SELECT
    'suspended_company:' || dc.id::text,
    'delivery_company'::text,
    dc.id,
    dc.name,
    w.id,
    NULL::uuid,
    NULL::text,
    COALESCE(w.eligible_balance, 0)::numeric,
    'suspension'::text,
    'Logistics company suspended; eligible earnings on hold'::text,
    dc.updated_at
  FROM public.delivery_companies dc
  JOIN public.wallets w ON w.user_id = dc.user_id AND w.wallet_type = 'delivery_company'
  WHERE dc.is_active = false
    AND COALESCE(w.eligible_balance, 0) > 0
),
failed_payouts AS (
  SELECT
    'failed_payout:' || pr.id::text,
    pr.user_type::text,
    CASE 
      WHEN pr.user_type = 'vendor' THEN (SELECT id FROM public.vendors WHERE user_id = pr.user_id LIMIT 1)
      WHEN pr.user_type = 'rider' THEN (SELECT id FROM public.rider_profiles WHERE user_id = pr.user_id LIMIT 1)
      WHEN pr.user_type = 'delivery_company' THEN (SELECT id FROM public.delivery_companies WHERE user_id = pr.user_id LIMIT 1)
    END,
    CASE 
      WHEN pr.user_type = 'vendor' THEN (SELECT name FROM public.vendors WHERE user_id = pr.user_id LIMIT 1)
      WHEN pr.user_type = 'rider' THEN (SELECT full_name FROM public.profiles WHERE user_id = pr.user_id LIMIT 1)
      WHEN pr.user_type = 'delivery_company' THEN (SELECT name FROM public.delivery_companies WHERE user_id = pr.user_id LIMIT 1)
    END,
    pr.wallet_id,
    NULL::uuid,
    NULL::text,
    pr.amount::numeric,
    'failed_payout'::text,
    ('Payout ' || pr.status || ' — ' || COALESCE(pr.failure_reason, 'review required'))::text,
    pr.updated_at
  FROM public.payout_requests pr
  WHERE pr.status IN ('failed','rejected')
)
SELECT * FROM (
  SELECT * FROM vendor_pending
  UNION ALL SELECT * FROM suspended_vendor
  UNION ALL SELECT * FROM suspended_company
  UNION ALL SELECT * FROM failed_payouts
) all_holds
WHERE hold_key NOT IN (SELECT hold_key FROM resolved)
  AND party_id IS NOT NULL
  AND amount > 0
ORDER BY held_since ASC NULLS LAST;

CREATE OR REPLACE FUNCTION public.admin_resolve_payment_hold(
  p_hold_key text,
  p_party_type text,
  p_party_id uuid,
  p_wallet_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_decision text,
  p_reason text,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_resolution_id uuid;
  v_is_test boolean;
  v_wallet_type text;
BEGIN
  IF NOT has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin required';
  END IF;
  IF p_decision NOT IN ('absorbed','released') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;
  IF length(coalesce(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'Reason must be at least 10 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_hold_resolutions WHERE hold_key = p_hold_key) THEN
    RAISE EXCEPTION 'Hold already resolved';
  END IF;

  INSERT INTO payment_hold_resolutions (
    hold_key, party_type, party_id, wallet_id, order_id,
    amount, decision, reason, source, resolved_by
  ) VALUES (
    p_hold_key, p_party_type, p_party_id, p_wallet_id, p_order_id,
    p_amount, p_decision, p_reason, p_source, v_caller
  ) RETURNING id INTO v_resolution_id;

  v_is_test := (get_platform_environment() = 'development');

  IF p_wallet_id IS NOT NULL AND p_amount > 0 THEN
    SELECT wallet_type INTO v_wallet_type FROM wallets WHERE id = p_wallet_id;
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);

    IF p_decision = 'released' THEN
      IF p_source = 'settlement_period' AND v_wallet_type = 'vendor' THEN
        IF v_is_test THEN
          UPDATE wallets SET
            test_pending_balance = GREATEST(COALESCE(test_pending_balance,0) - p_amount, 0),
            test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending,0) - p_amount, 0),
            test_eligible_balance = COALESCE(test_eligible_balance,0) + p_amount,
            test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) + p_amount,
            updated_at = NOW()
          WHERE id = p_wallet_id;
        ELSE
          UPDATE wallets SET
            pending_balance = GREATEST(COALESCE(pending_balance,0) - p_amount, 0),
            menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending,0) - p_amount, 0),
            eligible_balance = COALESCE(eligible_balance,0) + p_amount,
            menu_earnings_balance = COALESCE(menu_earnings_balance,0) + p_amount,
            updated_at = NOW()
          WHERE id = p_wallet_id;
        END IF;
      END IF;

      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount,
        wallet_id, environment, status, notes, order_id, metadata
      ) VALUES (
        v_wallet_type, 'admin_credit', 'credit', 0,
        p_wallet_id,
        CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
        'completed',
        '[HOLD RELEASED] ' || p_reason,
        p_order_id,
        jsonb_build_object('resolution_id', v_resolution_id, 'source', p_source, 'released_amount', p_amount)
      );

    ELSIF p_decision = 'absorbed' THEN
      IF p_source = 'settlement_period' AND v_wallet_type = 'vendor' THEN
        IF v_is_test THEN
          UPDATE wallets SET
            test_pending_balance = GREATEST(COALESCE(test_pending_balance,0) - p_amount, 0),
            test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending,0) - p_amount, 0),
            updated_at = NOW()
          WHERE id = p_wallet_id;
        ELSE
          UPDATE wallets SET
            pending_balance = GREATEST(COALESCE(pending_balance,0) - p_amount, 0),
            menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending,0) - p_amount, 0),
            updated_at = NOW()
          WHERE id = p_wallet_id;
        END IF;
      ELSE
        IF v_is_test THEN
          UPDATE wallets SET
            test_eligible_balance = GREATEST(COALESCE(test_eligible_balance,0) - p_amount, -5000),
            test_balance = GREATEST(COALESCE(test_balance,0) - p_amount, -5000),
            updated_at = NOW()
          WHERE id = p_wallet_id;
        ELSE
          UPDATE wallets SET
            eligible_balance = GREATEST(COALESCE(eligible_balance,0) - p_amount, -5000),
            balance = GREATEST(COALESCE(balance,0) - p_amount, -5000),
            updated_at = NOW()
          WHERE id = p_wallet_id;
        END IF;
      END IF;

      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount,
        wallet_id, environment, status, notes, order_id, metadata
      ) VALUES (
        v_wallet_type, 'admin_debit', 'debit', p_amount,
        p_wallet_id,
        CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
        'completed',
        '[HOLD ABSORBED BY PLATFORM] ' || p_reason,
        p_order_id,
        jsonb_build_object('resolution_id', v_resolution_id, 'source', p_source, 'absorbed_amount', p_amount)
      );
    END IF;

    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'resolution_id', v_resolution_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_payment_hold(text,text,uuid,uuid,uuid,numeric,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_resolve_payment_hold(text,text,uuid,uuid,uuid,numeric,text,text,text) TO authenticated;
