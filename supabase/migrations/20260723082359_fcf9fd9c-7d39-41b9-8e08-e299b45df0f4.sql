
-- 1) Default settlement settings for voucher vendors
INSERT INTO public.platform_settings (key, value)
VALUES 
  ('vendor_settlement_mode_voucher', 'next_day'),
  ('settlement_hours_voucher', '24')
ON CONFLICT (key) DO NOTHING;

-- 2) Teach vendor_settlement_release_at about the voucher category
CREATE OR REPLACE FUNCTION public.vendor_settlement_release_at(p_earned_at timestamp with time zone DEFAULT now(), p_wallet_id uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_timing text;
  v_category text;
  v_hours numeric := 0;
BEGIN
  SELECT lower(COALESCE(v.category::text, vo.store_type::text, 'restaurant'))
  INTO v_category
  FROM public.wallets w
  LEFT JOIN public.vendors v ON v.user_id = w.user_id
  LEFT JOIN public.vendor_outlets vo ON vo.id = w.outlet_id
  WHERE w.id = p_wallet_id
  LIMIT 1;

  v_category := CASE
    WHEN v_category LIKE '%pharm%' THEN 'pharmacy'
    WHEN v_category LIKE '%market%' OR v_category LIKE '%grocery%' THEN 'market'
    WHEN v_category LIKE '%voucher%' THEN 'voucher'
    ELSE 'restaurant'
  END;

  SELECT value INTO v_timing
  FROM public.platform_settings
  WHERE key = 'vendor_settlement_mode_' || v_category
  LIMIT 1;

  IF v_timing IS NULL THEN
    SELECT COALESCE(value, 'instant') INTO v_timing
    FROM public.platform_settings
    WHERE key = 'vendor_settlement_timing'
    LIMIT 1;
  END IF;

  v_timing := COALESCE(v_timing, 'instant');

  IF v_timing = 'next_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day';
  ELSIF v_timing = 'third_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '3 days';
  ELSIF v_timing = 'hours' THEN
    SELECT COALESCE(value::numeric, 0) INTO v_hours
    FROM public.platform_settings
    WHERE key = 'settlement_hours_' || v_category
    LIMIT 1;
    RETURN p_earned_at + make_interval(hours => v_hours::int);
  END IF;

  RETURN p_earned_at;
END;
$function$;

-- 3) Rewrite credit_vendor_wallet_for_voucher: route through menu earnings pools
--    honouring settlement mode, using the balance-manipulation bypass flag.
CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order          public.voucher_orders%ROWTYPE;
  v_vendor         public.vendors%ROWTYPE;
  v_outlet_id      UUID;
  v_wallet         public.wallets%ROWTYPE;
  v_environment    TEXT;
  v_is_test        BOOLEAN;
  v_net_amount     NUMERIC;
  v_release_at     TIMESTAMPTZ;
  v_released       BOOLEAN;
  v_reference      TEXT;
  v_tx_id          UUID;
BEGIN
  SELECT * INTO v_order FROM public.voucher_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher order % not found', _order_id;
  END IF;

  v_reference := 'VH-CREDIT-' || _order_id::text;
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference = v_reference AND category = 'voucher_sale'
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_order.vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor % not found', v_order.vendor_id;
  END IF;

  SELECT id INTO v_outlet_id
    FROM public.vendor_outlets
   WHERE vendor_id = v_vendor.id
   ORDER BY created_at ASC
   LIMIT 1;

  SELECT value INTO v_environment FROM public.platform_settings WHERE key = 'platform_environment';
  v_environment := COALESCE(v_environment, 'development');
  v_is_test := v_environment = 'development';

  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE user_id = v_vendor.user_id
     AND wallet_type = 'vendor'
     AND (outlet_id = v_outlet_id OR (outlet_id IS NULL AND v_outlet_id IS NULL))
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, wallet_type, outlet_id)
    VALUES (v_vendor.user_id, 'vendor', v_outlet_id)
    RETURNING * INTO v_wallet;
  END IF;

  v_net_amount := v_order.amount - COALESCE(v_order.commission_amount, 0);
  v_release_at := public.vendor_settlement_release_at(NOW(), v_wallet.id);
  v_released := COALESCE(v_release_at, NOW()) <= NOW();

  -- Insert the ledger row. balance_after is populated by trg_set_balance_after
  -- from the current wallet balance; we correct wallet pools below.
  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category,
    amount, reference, status, environment, notes, metadata, release_at
  ) VALUES (
    v_wallet.id, 'vendor', 'credit', 'voucher_sale',
    v_net_amount, v_reference, 'completed', v_environment,
    'Voucher sale earnings',
    jsonb_build_object(
      'voucher_order_id', _order_id,
      'gross', v_order.amount,
      'commission', v_order.commission_amount
    ),
    v_release_at
  )
  RETURNING id INTO v_tx_id;

  -- Update wallet pools with bypass flag so prevent_direct_balance_update allows it
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  IF v_released THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_net_amount,
        test_balance               = COALESCE(test_balance, 0)               + v_net_amount,
        test_eligible_balance      = COALESCE(test_eligible_balance, 0)      + v_net_amount,
        updated_at = NOW()
      WHERE id = v_wallet.id;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_net_amount,
        balance               = COALESCE(balance, 0)               + v_net_amount,
        eligible_balance      = COALESCE(eligible_balance, 0)      + v_net_amount,
        updated_at = NOW()
      WHERE id = v_wallet.id;
    END IF;

    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      v_wallet.id, v_tx_id, v_net_amount, 'vendor', 'voucher_sale',
      NOW(), NOW(), TRUE, NOW(), v_environment
    )
    ON CONFLICT (transaction_id) DO NOTHING;
  ELSE
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + v_net_amount,
        test_pending_balance       = COALESCE(test_pending_balance, 0)       + v_net_amount,
        updated_at = NOW()
      WHERE id = v_wallet.id;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + v_net_amount,
        pending_balance       = COALESCE(pending_balance, 0)       + v_net_amount,
        updated_at = NOW()
      WHERE id = v_wallet.id;
    END IF;

    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      v_wallet.id, v_tx_id, v_net_amount, 'vendor', 'voucher_sale',
      NOW(), v_release_at, FALSE, NULL, v_environment
    )
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END;
$function$;

-- 4) Re-credit the historical voucher order whose ledger row exists but wallet
--    pools weren't updated. Delete stale ledger + re-run so pools sync.
DELETE FROM public.wallet_transactions
 WHERE category = 'voucher_sale'
   AND reference LIKE 'VH-CREDIT-%'
   AND balance_after = 0
   AND amount > 0;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT vo.id
      FROM public.voucher_orders vo
     WHERE vo.status = 'paid'
       AND NOT EXISTS (
         SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.category = 'voucher_sale'
            AND wt.reference = 'VH-CREDIT-' || vo.id::text
       )
  LOOP
    PERFORM public.credit_vendor_wallet_for_voucher(r.id);
  END LOOP;
END;
$$;
