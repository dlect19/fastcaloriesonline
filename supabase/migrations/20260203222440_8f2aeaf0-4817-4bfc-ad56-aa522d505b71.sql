-- Add columns to track menu earnings vs rider delivery revenue separately
-- This allows vendors to see and withdraw from each pool independently

ALTER TABLE public.wallets 
  ADD COLUMN IF NOT EXISTS menu_earnings_balance numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS menu_earnings_pending numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rider_revenue_balance numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_menu_earnings_balance numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_menu_earnings_pending numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_rider_revenue_balance numeric DEFAULT 0;

-- Add withdrawal_source column to payout_requests to tag the source
ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS withdrawal_source text DEFAULT 'menu_earnings';

-- Add comment explaining the sources
COMMENT ON COLUMN public.payout_requests.withdrawal_source IS 'Source of withdrawal: menu_earnings (food sales), rider_revenue (affiliated rider deliveries)';

-- Create function to update separate balance pools on vendor_share credit
CREATE OR REPLACE FUNCTION public.update_vendor_revenue_pools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only process vendor wallet transactions
  IF NEW.wallet_type != 'vendor' THEN
    RETURN NEW;
  END IF;

  -- Handle vendor_share (menu earnings) - goes to pending first
  IF NEW.category = 'vendor_share' AND NEW.transaction_type = 'credit' THEN
    IF NEW.environment = 'development' THEN
      UPDATE wallets 
      SET test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets 
      SET menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  -- Handle vendor_rider_share (delivery revenue) - available immediately
  IF NEW.category = 'vendor_rider_share' AND NEW.transaction_type = 'credit' THEN
    IF NEW.environment = 'development' THEN
      UPDATE wallets 
      SET test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets 
      SET rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger for new transactions
DROP TRIGGER IF EXISTS trigger_update_vendor_revenue_pools ON wallet_transactions;
CREATE TRIGGER trigger_update_vendor_revenue_pools
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_revenue_pools();

-- Update the release_pending_vendor_earnings function to also update menu_earnings_balance
CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  released_count INTEGER := 0;
  hold_hours INTEGER := 24;
  tx RECORD;
  v_wallet_id UUID;
  v_is_test BOOLEAN;
  v_amount NUMERIC;
BEGIN
  -- Get hold period from platform settings (default 24 hours)
  SELECT COALESCE(value::integer, 24) INTO hold_hours 
  FROM platform_settings 
  WHERE key = 'vendor_hold_period_hours' 
  LIMIT 1;
  
  -- Find all pending vendor_share transactions past the hold period
  FOR tx IN 
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment
    FROM wallet_transactions wt
    WHERE wt.category = 'vendor_share'
      AND wt.status = 'pending'
      AND wt.created_at < NOW() - (hold_hours || ' hours')::interval
      AND wt.wallet_id IS NOT NULL
  LOOP
    v_wallet_id := tx.wallet_id;
    v_amount := tx.amount;
    v_is_test := (tx.environment = 'development');
    
    -- Move from pending_balance to eligible_balance, and from menu_pending to menu_balance
    IF v_is_test THEN
      UPDATE wallets 
      SET 
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - v_amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
        test_balance = COALESCE(test_balance, 0) + v_amount,
        test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - v_amount, 0),
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_amount,
        updated_at = NOW()
      WHERE id = v_wallet_id;
    ELSE
      UPDATE wallets 
      SET 
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
        balance = COALESCE(balance, 0) + v_amount,
        menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - v_amount, 0),
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_amount,
        updated_at = NOW()
      WHERE id = v_wallet_id;
    END IF;
    
    -- Mark transaction as completed
    UPDATE wallet_transactions
    SET 
      status = 'completed',
      notes = 'Released after hold period'
    WHERE id = tx.id;
    
    released_count := released_count + 1;
  END LOOP;
  
  RETURN released_count;
END;
$function$;