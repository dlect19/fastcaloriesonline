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
  v_notes TEXT;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');
  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  IF NEW.user_type = 'vendor' THEN
    PERFORM public.reconcile_vendor_wallet(NEW.wallet_id);
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN
    v_available := CASE WHEN v_is_test
      THEN COALESCE(v_wallet.test_rider_revenue_balance, 0)
      ELSE COALESCE(v_wallet.rider_revenue_balance, 0) END;
  ELSIF NEW.user_type = 'vendor' THEN
    v_available := CASE WHEN v_is_test
      THEN COALESCE(v_wallet.test_menu_earnings_balance, 0)
      ELSE COALESCE(v_wallet.menu_earnings_balance, 0) END;
  ELSE
    v_available := CASE WHEN v_is_test
      THEN COALESCE(v_wallet.test_eligible_balance, 0)
      ELSE COALESCE(v_wallet.eligible_balance, 0) END;
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  v_notes := CASE
    WHEN NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN 'Withdrawal - Rider Revenue'
    WHEN NEW.user_type = 'vendor' THEN 'Withdrawal - Menu Earnings'
    ELSE 'Withdrawal'
  END;

  -- Single safe entry point: posts the ledger row AND moves the balance atomically
  PERFORM public.post_wallet_entry(
    p_wallet_id => NEW.wallet_id,
    p_wallet_type => COALESCE(NEW.user_type, 'rider'),
    p_transaction_type => 'debit',
    p_category => 'withdrawal',
    p_amount => v_amount,
    p_reference => 'PAYOUT-REQ-' || NEW.id::text,
    p_environment => NEW.environment,
    p_order_id => NULL,
    p_notes => v_notes,
    p_metadata => jsonb_build_object(
      'payout_request_id', NEW.id,
      'user_type', NEW.user_type,
      'withdrawal_source', v_source,
      'source', 'deduct_wallet_on_payout_request'
    )
  );

  -- Keep auxiliary earnings buckets in sync (not separately ledgered)
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) - v_amount,
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        rider_revenue_balance = COALESCE(rider_revenue_balance, 0) - v_amount,
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  ELSIF NEW.user_type = 'vendor' THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) - v_amount,
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) - v_amount,
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  ELSE
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$$;