CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.voucher_orders%ROWTYPE;
  v_vendor     public.vendors%ROWTYPE;
  v_outlet_id  UUID;
  v_wallet     public.wallets%ROWTYPE;
  v_environment TEXT;
  v_is_test    BOOLEAN;
  v_net        NUMERIC;
  v_release_at TIMESTAMPTZ;
  v_released   BOOLEAN;
  v_reference  TEXT;
  v_balance_after NUMERIC;
  v_tx_id      UUID;
BEGIN
  SELECT * INTO v_order FROM public.voucher_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'voucher order % not found', _order_id; END IF;

  v_reference := 'VH-CREDIT-' || _order_id::text;
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference = v_reference AND category = 'voucher_sale') THEN
    RETURN;
  END IF;

  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_order.vendor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vendor % not found', v_order.vendor_id; END IF;

  SELECT id INTO v_outlet_id FROM public.vendor_outlets
   WHERE vendor_id = v_vendor.id ORDER BY created_at ASC LIMIT 1;

  SELECT COALESCE(value, 'development') INTO v_environment
    FROM public.platform_settings WHERE key = 'platform_environment';
  v_is_test := v_environment = 'development';

  SELECT * INTO v_wallet FROM public.wallets
   WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor'
     AND (outlet_id = v_outlet_id OR (outlet_id IS NULL AND v_outlet_id IS NULL))
   LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, wallet_type, outlet_id)
    VALUES (v_vendor.user_id, 'vendor', v_outlet_id)
    RETURNING * INTO v_wallet;
  END IF;

  v_net := v_order.amount - COALESCE(v_order.commission_amount, 0);
  v_release_at := public.vendor_settlement_release_at(NOW(), v_wallet.id);
  v_released := COALESCE(v_release_at, NOW()) <= NOW();

  IF v_released THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) + v_net,
        test_balance               = COALESCE(test_balance,0) + v_net,
        test_eligible_balance      = COALESCE(test_eligible_balance,0) + v_net,
        total_earned               = COALESCE(total_earned,0) + v_net,
        updated_at = NOW()
      WHERE id = v_wallet.id
      RETURNING test_balance INTO v_balance_after;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_balance = COALESCE(menu_earnings_balance,0) + v_net,
        balance               = COALESCE(balance,0) + v_net,
        eligible_balance      = COALESCE(eligible_balance,0) + v_net,
        total_earned          = COALESCE(total_earned,0) + v_net,
        updated_at = NOW()
      WHERE id = v_wallet.id
      RETURNING balance INTO v_balance_after;
    END IF;
  ELSE
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_pending = COALESCE(test_menu_earnings_pending,0) + v_net,
        test_pending_balance       = COALESCE(test_pending_balance,0) + v_net,
        total_earned               = COALESCE(total_earned,0) + v_net,
        updated_at = NOW()
      WHERE id = v_wallet.id
      RETURNING test_pending_balance INTO v_balance_after;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_pending = COALESCE(menu_earnings_pending,0) + v_net,
        pending_balance       = COALESCE(pending_balance,0) + v_net,
        total_earned          = COALESCE(total_earned,0) + v_net,
        updated_at = NOW()
      WHERE id = v_wallet.id
      RETURNING pending_balance INTO v_balance_after;
    END IF;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category,
    amount, reference, status, environment, notes, metadata,
    release_at, balance_after
  ) VALUES (
    v_wallet.id, 'vendor', 'credit', 'voucher_sale',
    v_net, v_reference, 'completed', v_environment,
    'Voucher sale earnings',
    jsonb_build_object('voucher_order_id', _order_id, 'gross', v_order.amount, 'commission', v_order.commission_amount),
    v_release_at, COALESCE(v_balance_after, 0)
  ) RETURNING id INTO v_tx_id;

  IF v_released THEN
    INSERT INTO public.payout_pending_releases
      (wallet_id, transaction_id, amount, wallet_type, category, earned_at, release_at, released, released_at, environment)
    VALUES
      (v_wallet.id, v_tx_id, v_net, 'vendor', 'voucher_sale', NOW(), NOW(), TRUE, NOW(), v_environment)
    ON CONFLICT (transaction_id) DO NOTHING;
  ELSE
    INSERT INTO public.payout_pending_releases
      (wallet_id, transaction_id, amount, wallet_type, category, earned_at, release_at, released, environment)
    VALUES
      (v_wallet.id, v_tx_id, v_net, 'vendor', 'voucher_sale', NOW(), v_release_at, FALSE, v_environment)
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vendor_pending_settlement(p_wallet_id uuid, p_environment text DEFAULT NULL::text)
RETURNS TABLE(pending_total numeric, next_release_at timestamp with time zone, item_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
BEGIN
  v_env := COALESCE(p_environment, get_platform_environment());
  RETURN QUERY
  SELECT
    COALESCE(SUM(amount), 0)::numeric,
    MIN(release_at),
    COUNT(*)::int
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_env
    AND transaction_type = 'credit'
    AND status = 'completed'
    AND category IN ('vendor_share','vendor_rider_share','voucher_sale')
    AND COALESCE(release_at, created_at) > NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_vendor_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;
  v_menu_unreleased NUMERIC;
  v_rider_balance NUMERIC;
  v_rider_unreleased NUMERIC;
  v_total_earned NUMERIC;
  v_env TEXT;
  v_is_test BOOLEAN;
BEGIN
  v_env := get_platform_environment();
  v_is_test := (v_env = 'development');

  SELECT COALESCE(SUM(CASE
    WHEN category IN ('vendor_share','voucher_sale') AND transaction_type = 'credit' AND status = 'completed'
         AND COALESCE(release_at, created_at) <= NOW() THEN amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND COALESCE(notes,'') ILIKE ANY(ARRAY['%Menu Earnings%','%Voucher Earnings%','%Voucher Sales%']) THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND COALESCE(notes,'') ILIKE ANY(ARRAY['%Menu Earnings%','%Voucher Earnings%','%Voucher Sales%']) THEN amount
    WHEN category = 'admin_debit' AND transaction_type = 'debit' THEN -amount
    WHEN category = 'admin_credit' AND transaction_type = 'credit' THEN amount
    ELSE 0 END), 0)
  INTO v_menu_balance
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_menu_pending
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_env
    AND category IN ('vendor_share','voucher_sale')
    AND transaction_type = 'credit'
    AND status = 'pending';

  SELECT COALESCE(SUM(amount), 0)
  INTO v_menu_unreleased
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_env
    AND category IN ('vendor_share','voucher_sale')
    AND transaction_type = 'credit'
    AND status = 'completed'
    AND COALESCE(release_at, created_at) > NOW();

  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed'
         AND COALESCE(release_at, created_at) <= NOW() THEN amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND COALESCE(notes,'') ILIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND COALESCE(notes,'') ILIKE '%Rider Revenue%' THEN amount
    ELSE 0 END), 0)
  INTO v_rider_balance
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_rider_unreleased
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_env
    AND category = 'vendor_rider_share'
    AND transaction_type = 'credit'
    AND status = 'completed'
    AND COALESCE(release_at, created_at) > NOW();

  SELECT COALESCE(SUM(CASE
    WHEN category IN ('vendor_share','vendor_rider_share','voucher_sale') AND transaction_type = 'credit' THEN amount
    WHEN category IN ('vendor_share','vendor_rider_share','voucher_sale') AND transaction_type = 'debit' THEN -amount
    ELSE 0 END), 0)
  INTO v_total_earned
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  IF v_is_test THEN
    UPDATE public.wallets SET
      test_menu_earnings_balance = GREATEST(v_menu_balance, 0),
      test_menu_earnings_pending = GREATEST(v_menu_pending + v_menu_unreleased, 0),
      test_rider_revenue_balance = GREATEST(v_rider_balance, 0),
      test_pending_balance = GREATEST(v_menu_pending + v_menu_unreleased + v_rider_unreleased, 0),
      test_eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      total_earned = GREATEST(v_total_earned, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  ELSE
    UPDATE public.wallets SET
      menu_earnings_balance = GREATEST(v_menu_balance, 0),
      menu_earnings_pending = GREATEST(v_menu_pending + v_menu_unreleased, 0),
      rider_revenue_balance = GREATEST(v_rider_balance, 0),
      pending_balance = GREATEST(v_menu_pending + v_menu_unreleased + v_rider_unreleased, 0),
      eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      total_earned = GREATEST(v_total_earned, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_voucher_wallet_reconciliation(p_vendor_id uuid, p_environment text DEFAULT NULL::text)
RETURNS TABLE(
  order_id uuid,
  purchased_at timestamp with time zone,
  category_name text,
  buyer_email text,
  buyer_phone text,
  gross_amount numeric,
  commission_amount numeric,
  net_expected numeric,
  ledger_amount numeric,
  ledger_status text,
  wallet_pool text,
  release_at timestamp with time zone,
  released boolean,
  wallet_id uuid,
  transaction_id uuid,
  paystack_reference text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
  v_owner uuid;
  v_allowed boolean;
BEGIN
  v_env := COALESCE(p_environment, get_platform_environment());

  SELECT user_id INTO v_owner FROM public.vendors WHERE id = p_vendor_id;
  v_allowed := v_owner = auth.uid()
    OR public.owns_vendor(p_vendor_id)
    OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs
      WHERE vs.vendor_id = p_vendor_id AND vs.user_id = auth.uid() AND vs.is_active = true
    )
    OR public.has_role(auth.uid(), 'admin');

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  SELECT
    vo.id,
    vo.purchased_at,
    vc.name::text,
    vo.guest_email::text,
    vo.guest_phone::text,
    vo.amount,
    COALESCE(vo.commission_amount, 0),
    vo.amount - COALESCE(vo.commission_amount, 0),
    COALESCE(wt.amount, 0),
    COALESCE(wt.status, 'missing')::text,
    CASE
      WHEN wt.id IS NULL THEN 'missing'
      WHEN COALESCE(wt.release_at, wt.created_at) > NOW() THEN 'pending'
      ELSE 'available'
    END::text,
    wt.release_at,
    COALESCE(ppr.released, COALESCE(wt.release_at, wt.created_at) <= NOW()),
    wt.wallet_id,
    wt.id,
    vo.paystack_reference::text
  FROM public.voucher_orders vo
  LEFT JOIN public.voucher_categories vc ON vc.id = vo.category_id
  LEFT JOIN public.wallet_transactions wt
    ON wt.category = 'voucher_sale'
   AND wt.environment = v_env
   AND wt.metadata->>'voucher_order_id' = vo.id::text
  LEFT JOIN public.payout_pending_releases ppr ON ppr.transaction_id = wt.id
  WHERE vo.vendor_id = p_vendor_id
    AND vo.status = 'paid'
  ORDER BY vo.purchased_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_voucher_wallet_reconciliation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_wallet_reconciliation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_pending_settlement(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_vendor_wallet(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_vendor_wallet_for_voucher(uuid) TO service_role;