
-- The custom bypass GUC could not be set from user-owned SECURITY DEFINER
-- functions, so the previous bypass path was silently ignored and wallet
-- pools never updated. Trust service_role callers (edge functions) instead:
-- Supabase edge functions connect as service_role, so this correctly lets
-- our server-side crediting code through while still blocking direct client
-- writes (authenticated users cannot become service_role).
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.bypass_balance_trigger', true) = 'true' THEN RETURN NEW; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  IF session_user = 'service_role' THEN RETURN NEW; END IF;

  NEW.balance := OLD.balance;
  NEW.test_balance := OLD.test_balance;
  NEW.pending_balance := OLD.pending_balance;
  NEW.test_pending_balance := OLD.test_pending_balance;
  NEW.eligible_balance := OLD.eligible_balance;
  NEW.test_eligible_balance := OLD.test_eligible_balance;
  NEW.total_earned := OLD.total_earned;
  NEW.total_withdrawn := OLD.total_withdrawn;
  NEW.pending_payouts := OLD.pending_payouts;
  NEW.menu_earnings_balance := OLD.menu_earnings_balance;
  NEW.test_menu_earnings_balance := OLD.test_menu_earnings_balance;
  NEW.menu_earnings_pending := OLD.menu_earnings_pending;
  NEW.test_menu_earnings_pending := OLD.test_menu_earnings_pending;
  NEW.rider_revenue_balance := OLD.rider_revenue_balance;
  NEW.test_rider_revenue_balance := OLD.test_rider_revenue_balance;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.get_vendor_settlement_info(p_wallet_id uuid)
RETURNS TABLE(category text, mode text, hours numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cat text; v_mode text; v_hours numeric := 0;
BEGIN
  SELECT lower(COALESCE(v.category::text, vo.store_type::text, 'restaurant'))
  INTO v_cat
  FROM public.wallets w
  LEFT JOIN public.vendors v ON v.user_id = w.user_id
  LEFT JOIN public.vendor_outlets vo ON vo.id = w.outlet_id
  WHERE w.id = p_wallet_id LIMIT 1;

  v_cat := CASE
    WHEN v_cat LIKE '%pharm%' THEN 'pharmacy'
    WHEN v_cat LIKE '%market%' OR v_cat LIKE '%grocery%' THEN 'market'
    WHEN v_cat LIKE '%voucher%' THEN 'voucher'
    ELSE 'restaurant'
  END;

  SELECT value INTO v_mode FROM public.platform_settings WHERE key = 'vendor_settlement_mode_' || v_cat LIMIT 1;
  IF v_mode IS NULL THEN
    SELECT value INTO v_mode FROM public.platform_settings WHERE key = 'vendor_settlement_timing' LIMIT 1;
  END IF;
  v_mode := COALESCE(v_mode, 'instant');

  IF v_mode = 'hours' THEN
    SELECT COALESCE(NULLIF(value,'')::numeric, 0) INTO v_hours
    FROM public.platform_settings WHERE key = 'settlement_hours_' || v_cat LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_cat, v_mode, COALESCE(v_hours, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
END; $$;

DELETE FROM public.wallet_transactions
 WHERE reference = 'VH-CREDIT-06925c93-8229-4f8d-8d63-95786d58cee8';
SELECT public.credit_vendor_wallet_for_voucher('06925c93-8229-4f8d-8d63-95786d58cee8');
SELECT public.credit_vendor_wallet_for_voucher('69c70ae3-e76e-4105-ade2-d325b3baea5d');
