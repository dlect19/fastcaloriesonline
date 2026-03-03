
-- Fix race condition: Add FOR UPDATE lock to prevent concurrent withdrawals
-- This ensures only one withdrawal can be processed at a time per wallet
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

  -- Bypass the prevent_direct_balance_update trigger
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');

  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  -- CRITICAL: Use FOR UPDATE to lock the wallet row, preventing concurrent withdrawals
  SELECT * INTO v_wallet FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
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
        UPDATE wallets SET
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          rider_revenue_balance = COALESCE(rider_revenue_balance, 0) - v_amount,
          eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
          balance = COALESCE(balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
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
      UPDATE wallets SET
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        test_balance = COALESCE(test_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets SET
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        balance = COALESCE(balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  -- Record the withdrawal transaction
  INSERT INTO wallet_transactions (
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
