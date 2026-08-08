CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_tx_id      UUID;
BEGIN
  SELECT * INTO v_order FROM public.voucher_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'voucher order % not found', _order_id; END IF;

  IF v_order.status IS DISTINCT FROM 'paid' THEN
    RETURN;
  END IF;

  v_reference := 'VH-CREDIT-' || _order_id::text;

  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference = v_reference AND category = 'voucher_sale') THEN
    UPDATE public.voucher_orders
      SET wallet_credited_at = COALESCE(wallet_credited_at, NOW()),
          wallet_credit_error = NULL
      WHERE id = _order_id;
    RETURN;
  END IF;

  BEGIN
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
    IF v_net <= 0 THEN RETURN; END IF;

    v_release_at := public.vendor_settlement_release_at(NOW(), v_wallet.id);
    v_released := COALESCE(v_release_at, NOW()) <= NOW();

    -- Post through the single money-posting routine (ledger = source of truth)
    v_tx_id := public.post_wallet_entry(
      p_wallet_id => v_wallet.id,
      p_wallet_type => 'vendor',
      p_transaction_type => 'credit',
      p_category => 'voucher_sale',
      p_amount => v_net,
      p_reference => v_reference,
      p_environment => v_environment,
      p_order_id => NULL,
      p_notes => 'Voucher sale earnings',
      p_metadata => jsonb_build_object(
        'voucher_order_id', _order_id,
        'gross', v_order.amount,
        'commission', v_order.commission_amount,
        'source', 'credit_vendor_wallet_for_voucher'
      ),
      p_target => 'balance',
      p_status => CASE WHEN v_released THEN 'completed' ELSE 'pending' END
    );

    UPDATE public.wallet_transactions SET release_at = v_release_at WHERE id = v_tx_id;

    -- Auxiliary buckets (do not affect balance; bypass the guard trigger)
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF v_released THEN
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) + v_net,
          test_eligible_balance      = COALESCE(test_eligible_balance,0) + v_net,
          total_earned               = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance,0) + v_net,
          eligible_balance      = COALESCE(eligible_balance,0) + v_net,
          total_earned          = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_pending = COALESCE(test_menu_earnings_pending,0) + v_net,
          test_pending_balance       = COALESCE(test_pending_balance,0) + v_net,
          total_earned               = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_pending = COALESCE(menu_earnings_pending,0) + v_net,
          pending_balance       = COALESCE(pending_balance,0) + v_net,
          total_earned          = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id;
      END IF;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);

    UPDATE public.voucher_orders
      SET wallet_credited_at = NOW(), wallet_credit_error = NULL
      WHERE id = _order_id;

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.voucher_orders
      SET wallet_credit_error = LEFT(SQLERRM, 500)
      WHERE id = _order_id;
    RAISE WARNING '[voucher-credit] order % failed: %', _order_id, SQLERRM;
  END;
END;
$function$;