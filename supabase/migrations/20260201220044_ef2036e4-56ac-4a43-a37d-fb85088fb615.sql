
-- Create function to release pending vendor earnings after hold period
CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    
    -- Move from pending_balance to eligible_balance
    IF v_is_test THEN
      UPDATE wallets 
      SET 
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - v_amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
        test_balance = COALESCE(test_balance, 0) + v_amount,
        updated_at = NOW()
      WHERE id = v_wallet_id;
    ELSE
      UPDATE wallets 
      SET 
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
        balance = COALESCE(balance, 0) + v_amount,
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
$$;

-- Also add the platform setting for hold period if not exists
INSERT INTO platform_settings (key, value, description)
VALUES ('vendor_hold_period_hours', '24', 'Hours to hold vendor earnings before making them eligible for withdrawal')
ON CONFLICT (key) DO NOTHING;
