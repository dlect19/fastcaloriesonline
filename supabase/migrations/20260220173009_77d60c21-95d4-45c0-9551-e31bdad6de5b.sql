
-- Fix reconcile_vendor_wallet to use the correct environment instead of hardcoding 'production'
CREATE OR REPLACE FUNCTION public.reconcile_vendor_wallet(p_wallet_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;
  v_rider_balance NUMERIC;
  v_total_earned NUMERIC;
  v_env TEXT;
  v_is_test BOOLEAN;
BEGIN
  v_env := get_platform_environment();
  v_is_test := (v_env = 'development');

  -- Menu earnings balance (released - cancelled - withdrawn + reversed)
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'vendor_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND notes LIKE '%Menu Earnings%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND notes LIKE '%Menu Earnings%' THEN amount
    ELSE 0
  END), 0) INTO v_menu_balance
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  -- Menu pending
  SELECT COALESCE(SUM(amount), 0) INTO v_menu_pending
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env
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
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  v_total_earned := v_menu_balance + v_menu_pending + v_rider_balance;

  IF v_is_test THEN
    UPDATE wallets SET
      test_menu_earnings_balance = GREATEST(v_menu_balance, 0),
      test_menu_earnings_pending = GREATEST(v_menu_pending, 0),
      test_rider_revenue_balance = GREATEST(v_rider_balance, 0),
      test_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_pending_balance = GREATEST(v_menu_pending, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  ELSE
    UPDATE wallets SET
      menu_earnings_balance = GREATEST(v_menu_balance, 0),
      menu_earnings_pending = GREATEST(v_menu_pending, 0),
      rider_revenue_balance = GREATEST(v_rider_balance, 0),
      balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      pending_balance = GREATEST(v_menu_pending, 0),
      total_earned = GREATEST(v_total_earned, 0)
    WHERE id = p_wallet_id;
  END IF;
END;
$$;
