
-- Create trigger function to auto-insert payout_pending_releases for vendor earnings
CREATE OR REPLACE FUNCTION public.create_vendor_pending_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor_category TEXT;
  v_settlement_hours INTEGER;
  v_vendor_id UUID;
BEGIN
  -- Only process vendor_share credits (vendor earnings from orders)
  IF NEW.wallet_type != 'vendor' OR NEW.category != 'vendor_share' OR NEW.transaction_type != 'credit' THEN
    RETURN NEW;
  END IF;

  -- Get the vendor's category from the order
  IF NEW.order_id IS NOT NULL THEN
    SELECT v.category INTO v_vendor_category
    FROM orders o
    JOIN vendors v ON v.id = o.vendor_id
    WHERE o.id = NEW.order_id;
  END IF;

  -- Look up the settlement hours for this vendor category
  v_settlement_hours := 24; -- default fallback
  IF v_vendor_category IS NOT NULL THEN
    SELECT COALESCE(value::INTEGER, 24) INTO v_settlement_hours
    FROM platform_settings
    WHERE key = 'settlement_hours_' || LOWER(v_vendor_category::TEXT);
  END IF;

  -- If settlement hours is 0, immediately release (no pending hold)
  IF v_settlement_hours = 0 THEN
    -- Move directly to eligible: subtract from pending, add to eligible
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE wallets SET
        test_pending_balance = COALESCE(test_pending_balance, 0) - NEW.amount,
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets SET
        pending_balance = COALESCE(pending_balance, 0) - NEW.amount,
        eligible_balance = COALESCE(eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    
    -- Still insert a record but mark it as already released
    INSERT INTO payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      NOW(), NOW(), TRUE, NOW(), NEW.environment
    );
  ELSE
    -- Insert pending release with the correct hold period
    INSERT INTO payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      NOW(), NOW() + (v_settlement_hours || ' hours')::INTERVAL, FALSE, NEW.environment
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Create the trigger on wallet_transactions AFTER INSERT
DROP TRIGGER IF EXISTS trg_create_vendor_pending_release ON wallet_transactions;
CREATE TRIGGER trg_create_vendor_pending_release
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION create_vendor_pending_release();

-- Fix release_pending_payouts: Don't double-add to menu_earnings_balance
-- since credit_vendor_on_payment already adds to it
CREATE OR REPLACE FUNCTION public.release_pending_payouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_released_count INTEGER := 0;
  v_pending RECORD;
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  FOR v_pending IN 
    SELECT * FROM payout_pending_releases 
    WHERE NOT released AND release_at <= NOW()
  LOOP
    IF v_pending.wallet_type = 'vendor' THEN
      -- Vendor: move from pending to eligible only (menu_earnings_balance already credited by trigger)
      IF v_pending.environment = 'development' THEN
        UPDATE wallets SET
          test_pending_balance = COALESCE(test_pending_balance, 0) - v_pending.amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_pending.amount,
          updated_at = NOW()
        WHERE id = v_pending.wallet_id;
      ELSE
        UPDATE wallets SET
          pending_balance = COALESCE(pending_balance, 0) - v_pending.amount,
          eligible_balance = COALESCE(eligible_balance, 0) + v_pending.amount,
          updated_at = NOW()
        WHERE id = v_pending.wallet_id;
      END IF;
    END IF;
    
    UPDATE wallet_transactions 
    SET status = 'completed', 
        notes = REPLACE(notes, '(pending hold period)', '(hold period completed)'),
        updated_at = NOW()
    WHERE id = v_pending.transaction_id;
    
    UPDATE payout_pending_releases 
    SET released = TRUE, released_at = NOW(), updated_at = NOW()
    WHERE id = v_pending.id;
    
    v_released_count := v_released_count + 1;
  END LOOP;
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN v_released_count;
END;
$function$;
