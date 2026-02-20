
-- One-time fix: Correct TOP KITCHEN's wallet balance after trigger bypass was added
-- The earnings were released (transaction exists) but wallet columns weren't updated
-- because the release ran before the bypass fix was deployed

DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  
  UPDATE wallets 
  SET 
    menu_earnings_balance = 1645.00,
    eligible_balance = 1645.00,
    balance = 1645.00,
    menu_earnings_pending = 0,
    pending_balance = 0,
    updated_at = NOW()
  WHERE id = '1bb29c33-a559-44de-98b7-7b3eec2ff80f';
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END $$;
