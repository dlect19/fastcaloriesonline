CREATE OR REPLACE FUNCTION reconcile_vendor_wallet(p_wallet_id UUID)
RETURNS void AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;
  v_rider_balance NUMERIC;
  v_total_earned NUMERIC;
BEGIN
  -- Menu earnings balance (released - cancelled - withdrawn + reversed)
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'vendor_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND notes LIKE '%Menu Earnings%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND notes LIKE '%Menu Earnings%' THEN amount
    ELSE 0
  END), 0) INTO v_menu_balance
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  -- Menu pending
  SELECT COALESCE(SUM(amount), 0) INTO v_menu_pending
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'pending';

  -- Rider revenue balance
  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'vendor_rider_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND notes LIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND notes LIKE '%Rider Revenue%' THEN amount
    ELSE 0
  END), 0) INTO v_rider_balance
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  v_total_earned := v_menu_balance + v_menu_pending + v_rider_balance;

  UPDATE wallets SET
    menu_earnings_balance = GREATEST(v_menu_balance, 0),
    menu_earnings_pending = GREATEST(v_menu_pending, 0),
    rider_revenue_balance = GREATEST(v_rider_balance, 0),
    balance = GREATEST(v_menu_balance + v_rider_balance, 0),
    eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
    pending_balance = GREATEST(v_menu_pending, 0),
    total_earned = GREATEST(v_total_earned, 0)
  WHERE id = p_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run for the affected vendor wallet
SELECT reconcile_vendor_wallet('dda25eae-766b-4815-9f14-b79ffbbf9bad');