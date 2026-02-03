-- Backfill the separated revenue pools from existing wallet balances
-- For vendor wallets, the existing pending_balance is from vendor_share (menu earnings)
-- The existing balance/eligible_balance may have rider revenue mixed in

-- Step 1: Backfill menu earnings pending from existing pending_balance
UPDATE wallets
SET 
  menu_earnings_pending = COALESCE(pending_balance, 0),
  test_menu_earnings_pending = COALESCE(test_pending_balance, 0)
WHERE wallet_type = 'vendor';

-- Step 2: Calculate menu earnings balance and rider revenue from transaction history
-- Menu earnings balance = sum of completed vendor_share transactions
-- Rider revenue balance = sum of completed vendor_rider_share transactions

-- For production environment
UPDATE wallets w
SET menu_earnings_balance = COALESCE((
  SELECT SUM(wt.amount)
  FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id 
    AND wt.category = 'vendor_share' 
    AND wt.status = 'completed'
    AND wt.transaction_type = 'credit'
    AND (wt.environment = 'production' OR wt.environment IS NULL)
), 0)
WHERE w.wallet_type = 'vendor';

UPDATE wallets w
SET rider_revenue_balance = COALESCE((
  SELECT SUM(wt.amount)
  FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id 
    AND wt.category = 'vendor_rider_share' 
    AND wt.status = 'completed'
    AND wt.transaction_type = 'credit'
    AND (wt.environment = 'production' OR wt.environment IS NULL)
), 0)
WHERE w.wallet_type = 'vendor';

-- For test environment
UPDATE wallets w
SET test_menu_earnings_balance = COALESCE((
  SELECT SUM(wt.amount)
  FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id 
    AND wt.category = 'vendor_share' 
    AND wt.status = 'completed'
    AND wt.transaction_type = 'credit'
    AND wt.environment = 'development'
), 0)
WHERE w.wallet_type = 'vendor';

UPDATE wallets w
SET test_rider_revenue_balance = COALESCE((
  SELECT SUM(wt.amount)
  FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id 
    AND wt.category = 'vendor_rider_share' 
    AND wt.status = 'completed'
    AND wt.transaction_type = 'credit'
    AND wt.environment = 'development'
), 0)
WHERE w.wallet_type = 'vendor';