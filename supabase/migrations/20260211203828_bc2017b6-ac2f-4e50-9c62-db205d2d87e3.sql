
-- Add environment column to payout_requests
ALTER TABLE public.payout_requests 
ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'development';

-- Backfill existing records based on their orders' environment
-- For now, set all existing records to 'development' since they're all test data
UPDATE public.payout_requests SET environment = 'development' WHERE environment IS NULL;

-- Update the restore_wallet_on_payout_failure trigger to also handle 'cancelled' status
CREATE OR REPLACE FUNCTION public.restore_wallet_on_payout_failure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
BEGIN
  -- Only run when status changes TO failed, rejected, or cancelled
  IF (NEW.status IN ('failed', 'rejected', 'cancelled')) 
     AND (OLD.status NOT IN ('failed', 'rejected', 'cancelled')) THEN
    
    v_amount := NEW.amount;
    v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');
    v_is_test := (get_platform_environment() = 'development');

    -- Restore to source-specific pool
    IF NEW.user_type = 'vendor' THEN
      IF v_source = 'rider_revenue' THEN
        IF v_is_test THEN
          UPDATE wallets SET
            test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_amount,
            test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
            test_balance = COALESCE(test_balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        ELSE
          UPDATE wallets SET
            rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_amount,
            eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
            balance = COALESCE(balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        END IF;
      ELSE
        IF v_is_test THEN
          UPDATE wallets SET
            test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_amount,
            test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
            test_balance = COALESCE(test_balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        ELSE
          UPDATE wallets SET
            menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_amount,
            eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
            balance = COALESCE(balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        END IF;
      END IF;
    ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
      IF v_is_test THEN
        UPDATE wallets SET
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
          test_balance = COALESCE(test_balance, 0) + v_amount,
          pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
          balance = COALESCE(balance, 0) + v_amount,
          pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;

    -- Log reversal transaction
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount,
      wallet_id, environment, status, notes
    ) VALUES (
      NEW.user_type, 'withdrawal_reversal', 'credit', v_amount,
      NEW.wallet_id,
      CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
      'completed',
      'Withdrawal ' || NEW.status || ' - ₦' || v_amount || ' restored to ' ||
      CASE v_source WHEN 'rider_revenue' THEN 'Rider Revenue' ELSE 'Menu Earnings' END
    );
  END IF;

  -- Also handle completed status - deduct from pending_payouts and add to total_withdrawn
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    v_amount := NEW.amount;
    UPDATE wallets SET
      pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
      total_withdrawn = COALESCE(total_withdrawn, 0) + v_amount,
      updated_at = NOW()
    WHERE id = NEW.wallet_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Update deduct_wallet_on_payout_request to also set environment
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
BEGIN
  -- Only run on INSERT
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');

  -- Get wallet and determine environment
  SELECT * INTO v_wallet FROM wallets WHERE id = NEW.wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  -- Determine environment from current platform setting
  v_is_test := (get_platform_environment() = 'development');

  -- Auto-set environment on the payout request
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  -- Deduct from source-specific pool
  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      IF v_is_test THEN
        UPDATE wallets SET
          test_rider_revenue_balance = GREATEST(COALESCE(test_rider_revenue_balance, 0) - v_amount, 0),
          test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
          test_balance = GREATEST(COALESCE(test_balance, 0) - v_amount, 0),
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          rider_revenue_balance = GREATEST(COALESCE(rider_revenue_balance, 0) - v_amount, 0),
          eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
          balance = GREATEST(COALESCE(balance, 0) - v_amount, 0),
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      -- menu_earnings source
      IF v_is_test THEN
        UPDATE wallets SET
          test_menu_earnings_balance = GREATEST(COALESCE(test_menu_earnings_balance, 0) - v_amount, 0),
          test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
          test_balance = GREATEST(COALESCE(test_balance, 0) - v_amount, 0),
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          menu_earnings_balance = GREATEST(COALESCE(menu_earnings_balance, 0) - v_amount, 0),
          eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
          balance = GREATEST(COALESCE(balance, 0) - v_amount, 0),
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
  ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
    -- Rider and delivery company: deduct from main balance
    IF v_is_test THEN
      UPDATE wallets SET
        test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_amount, 0),
        test_balance = GREATEST(COALESCE(test_balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets SET
        eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_amount, 0),
        balance = GREATEST(COALESCE(balance, 0) - v_amount, 0),
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  -- Log withdrawal transaction in ledger
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
