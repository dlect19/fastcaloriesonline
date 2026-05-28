INSERT INTO public.platform_settings (key, value, description)
VALUES ('vendor_settlement_timing', 'instant', 'Global vendor settlement timing: instant, next_day, or third_day')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vendor_settlement_release_at(p_earned_at timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timing text;
BEGIN
  SELECT COALESCE(value, 'instant') INTO v_timing
  FROM public.platform_settings
  WHERE key = 'vendor_settlement_timing'
  LIMIT 1;

  IF v_timing = 'next_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day';
  ELSIF v_timing = 'third_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '3 days';
  END IF;

  RETURN p_earned_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vendor_pending_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_release_at timestamptz;
BEGIN
  IF NEW.wallet_type != 'vendor' OR NEW.category != 'vendor_share' OR NEW.transaction_type != 'credit' THEN
    RETURN NEW;
  END IF;

  v_release_at := public.vendor_settlement_release_at(COALESCE(NEW.created_at, NOW()));

  IF v_release_at <= NOW() THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE public.wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - NEW.amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - NEW.amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);

    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      COALESCE(NEW.created_at, NOW()), NOW(), TRUE, NOW(), NEW.environment
    );
  ELSE
    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      COALESCE(NEW.created_at, NOW()), v_release_at, FALSE, NEW.environment
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  released_count INTEGER := 0;
  tx RECORD;
  v_is_test BOOLEAN;
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  FOR tx IN
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment, wt.created_at
    FROM public.wallet_transactions wt
    WHERE wt.category = 'vendor_share'
      AND wt.status = 'pending'
      AND wt.wallet_id IS NOT NULL
      AND public.vendor_settlement_release_at(COALESCE(wt.created_at, NOW())) <= NOW()
  LOOP
    v_is_test := (tx.environment = 'development');

    IF v_is_test THEN
      UPDATE public.wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - tx.amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + tx.amount,
        test_balance = COALESCE(test_balance, 0) + tx.amount,
        test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - tx.amount, 0),
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    ELSE
      UPDATE public.wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - tx.amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + tx.amount,
        balance = COALESCE(balance, 0) + tx.amount,
        menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - tx.amount, 0),
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    END IF;

    UPDATE public.wallet_transactions
    SET status = 'completed',
        notes = 'Released by vendor settlement schedule',
        updated_at = NOW()
    WHERE id = tx.id;

    UPDATE public.payout_pending_releases
    SET released = TRUE, released_at = NOW(), updated_at = NOW()
    WHERE transaction_id = tx.id AND NOT released;

    released_count := released_count + 1;
  END LOOP;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN released_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.deduct_wallet_on_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
  v_available NUMERIC;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');
  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  IF NEW.user_type = 'vendor' THEN
    PERFORM public.reconcile_vendor_wallet(NEW.wallet_id);
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      v_available := CASE WHEN v_is_test
        THEN COALESCE(v_wallet.test_rider_revenue_balance, 0)
        ELSE COALESCE(v_wallet.rider_revenue_balance, 0) END;
    ELSE
      v_available := CASE WHEN v_is_test
        THEN COALESCE(v_wallet.test_menu_earnings_balance, 0)
        ELSE COALESCE(v_wallet.menu_earnings_balance, 0) END;
    END IF;
  ELSE
    v_available := CASE WHEN v_is_test
      THEN COALESCE(v_wallet.test_eligible_balance, 0)
      ELSE COALESCE(v_wallet.eligible_balance, 0) END;
  END IF;

  IF v_amount > v_available THEN
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          rider_revenue_balance = COALESCE(rider_revenue_balance, 0) - v_amount,
          eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
          balance = COALESCE(balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance, 0) - v_amount,
          eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
          balance = COALESCE(balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
  ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        test_balance = COALESCE(test_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        balance = COALESCE(balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount,
    order_id, environment, status, notes
  ) VALUES (
    NEW.wallet_id,
    COALESCE(NEW.user_type, 'rider'),
    'debit',
    'withdrawal',
    v_amount,
    NULL,
    NEW.environment,
    'completed',
    CASE
      WHEN NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN 'Withdrawal - Rider Revenue'
      WHEN NEW.user_type = 'vendor' THEN 'Withdrawal - Menu Earnings'
      ELSE 'Withdrawal'
    END
  );

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$$;