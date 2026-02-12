
-- Fix the deduct_wallet_on_payout_request trigger to REJECT withdrawals
-- that exceed the available balance instead of allowing them with GREATEST(0)
CREATE OR REPLACE FUNCTION deduct_wallet_on_payout_request()
RETURNS TRIGGER AS $$
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

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');

  SELECT * INTO v_wallet FROM wallets WHERE id = NEW.wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_is_test := (get_platform_environment() = 'development');

  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  -- Check sufficient balance BEFORE deducting
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
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  -- Deduct from source-specific pool (no GREATEST needed since we validated above)
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

  -- Log withdrawal transaction
  INSERT INTO wallet_transactions (
    wallet_type, category, transaction_type, amount, 
    wallet_id, environment, status, notes
  ) VALUES (
    NEW.user_type, 'withdrawal', 'debit', v_amount,
    NEW.wallet_id, 
    CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
    'completed',
    'Withdrawal request of ₦' || v_amount || ' - ' || 
    CASE v_source WHEN 'rider_revenue' THEN 'Rider Revenue' ELSE 'Menu Earnings' END
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
