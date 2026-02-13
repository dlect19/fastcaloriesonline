
-- Reconciliation function for rider wallets
CREATE OR REPLACE FUNCTION public.reconcile_rider_wallet(p_wallet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_earned NUMERIC;
  v_withdrawn NUMERIC;
  v_reversed NUMERIC;
  v_net NUMERIC;
BEGIN
  -- Credits from rider_share
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'rider_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'rider_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    ELSE 0
  END), 0) INTO v_earned
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  -- Withdrawals
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'withdrawal' AND transaction_type = 'debit' AND status = 'completed';

  -- Withdrawal reversals
  SELECT COALESCE(SUM(amount), 0) INTO v_reversed
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'withdrawal_reversal' AND transaction_type = 'credit' AND status = 'completed';

  v_net := v_earned - v_withdrawn + v_reversed;

  UPDATE wallets SET
    balance = GREATEST(v_net, 0),
    eligible_balance = GREATEST(v_net, 0),
    total_earned = GREATEST(v_earned, 0)
  WHERE id = p_wallet_id;
END;
$function$;

-- Reconciliation function for delivery company wallets
CREATE OR REPLACE FUNCTION public.reconcile_delivery_company_wallet(p_wallet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_earned NUMERIC;
  v_withdrawn NUMERIC;
  v_reversed NUMERIC;
  v_net NUMERIC;
BEGIN
  -- Credits from delivery_company_share
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'delivery_company_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'delivery_company_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    ELSE 0
  END), 0) INTO v_earned
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  -- Withdrawals
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'withdrawal' AND transaction_type = 'debit' AND status = 'completed';

  -- Withdrawal reversals
  SELECT COALESCE(SUM(amount), 0) INTO v_reversed
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'withdrawal_reversal' AND transaction_type = 'credit' AND status = 'completed';

  v_net := v_earned - v_withdrawn + v_reversed;

  UPDATE wallets SET
    balance = GREATEST(v_net, 0),
    eligible_balance = GREATEST(v_net, 0),
    total_earned = GREATEST(v_earned, 0)
  WHERE id = p_wallet_id;
END;
$function$;

-- Reconciliation function for customer wallets
CREATE OR REPLACE FUNCTION public.reconcile_customer_wallet(p_wallet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_credits NUMERIC;
  v_debits NUMERIC;
  v_net NUMERIC;
BEGIN
  -- All credits (funding, refunds, adjustments)
  SELECT COALESCE(SUM(amount), 0) INTO v_credits
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND transaction_type = 'credit' AND status = 'completed';

  -- All debits (payments, adjustments)
  SELECT COALESCE(SUM(amount), 0) INTO v_debits
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND transaction_type = 'debit' AND status = 'completed';

  v_net := v_credits - v_debits;

  UPDATE wallets SET
    balance = GREATEST(v_net, 0),
    eligible_balance = GREATEST(v_net, 0)
  WHERE id = p_wallet_id;
END;
$function$;

-- Now update the deduct trigger to reconcile ALL wallet types
CREATE OR REPLACE FUNCTION public.deduct_wallet_on_payout_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  -- RECONCILE wallet before checking balance to prevent drift issues
  IF NEW.user_type = 'vendor' THEN
    PERFORM reconcile_vendor_wallet(NEW.wallet_id);
  ELSIF NEW.user_type = 'rider' THEN
    PERFORM reconcile_rider_wallet(NEW.wallet_id);
  ELSIF NEW.user_type = 'delivery_company' THEN
    PERFORM reconcile_delivery_company_wallet(NEW.wallet_id);
  ELSIF NEW.user_type = 'customer' THEN
    PERFORM reconcile_customer_wallet(NEW.wallet_id);
  END IF;

  -- Re-fetch wallet AFTER reconciliation
  SELECT * INTO v_wallet FROM wallets WHERE id = NEW.wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

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

  -- Deduct from source-specific pool
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
$function$;
