
-- Add category-based settlement period settings
INSERT INTO platform_settings (key, value, description)
VALUES 
  ('settlement_hours_restaurant', '0', 'Settlement hold period in hours for restaurant vendors'),
  ('settlement_hours_pharmacy', '12', 'Settlement hold period in hours for pharmacy vendors'),
  ('settlement_hours_market', '24', 'Settlement hold period in hours for market vendors')
ON CONFLICT (key) DO NOTHING;

-- Update the release_pending_vendor_earnings function to use category-based hold periods
CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  released_count INTEGER := 0;
  default_hold_hours INTEGER := 24;
  restaurant_hold INTEGER := 0;
  pharmacy_hold INTEGER := 12;
  market_hold INTEGER := 24;
  tx RECORD;
  v_wallet_id UUID;
  v_is_test BOOLEAN;
  v_amount NUMERIC;
  v_vendor_category TEXT;
  v_hold_hours INTEGER;
BEGIN
  -- Get default hold period from platform settings
  SELECT COALESCE(value::integer, 24) INTO default_hold_hours 
  FROM platform_settings 
  WHERE key = 'vendor_hold_period_hours' 
  LIMIT 1;
  
  -- Get category-specific hold periods
  SELECT COALESCE(value::integer, 0) INTO restaurant_hold 
  FROM platform_settings 
  WHERE key = 'settlement_hours_restaurant' 
  LIMIT 1;
  
  SELECT COALESCE(value::integer, 12) INTO pharmacy_hold 
  FROM platform_settings 
  WHERE key = 'settlement_hours_pharmacy' 
  LIMIT 1;
  
  SELECT COALESCE(value::integer, 24) INTO market_hold 
  FROM platform_settings 
  WHERE key = 'settlement_hours_market' 
  LIMIT 1;
  
  -- Find all pending vendor_share transactions and check against category-specific hold periods
  FOR tx IN 
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment, wt.created_at,
           v.category AS vendor_category
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    JOIN vendors v ON v.user_id = w.user_id
    WHERE wt.category = 'vendor_share'
      AND wt.status = 'pending'
      AND wt.wallet_id IS NOT NULL
  LOOP
    v_wallet_id := tx.wallet_id;
    v_amount := tx.amount;
    v_is_test := (tx.environment = 'development');
    v_vendor_category := COALESCE(tx.vendor_category, 'restaurant');
    
    -- Determine hold hours based on vendor category
    v_hold_hours := CASE v_vendor_category
      WHEN 'restaurant' THEN restaurant_hold
      WHEN 'pharmacy' THEN pharmacy_hold
      WHEN 'market' THEN market_hold
      ELSE default_hold_hours
    END;
    
    -- Skip if hold period hasn't passed yet
    IF tx.created_at >= NOW() - (v_hold_hours || ' hours')::interval THEN
      CONTINUE;
    END IF;
    
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
      notes = 'Released after ' || v_hold_hours || 'hr hold (' || v_vendor_category || ')'
    WHERE id = tx.id;
    
    released_count := released_count + 1;
  END LOOP;
  
  RETURN released_count;
END;
$function$;
