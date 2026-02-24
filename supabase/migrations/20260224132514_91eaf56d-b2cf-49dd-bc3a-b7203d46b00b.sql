
-- Correct rider wallet balance for the 116 overpayment
DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  
  UPDATE wallets SET 
    balance = balance - 116,
    eligible_balance = eligible_balance - 116,
    total_earned = total_earned - 116
  WHERE id = 'c112c9a9-2486-4da6-8adc-474309f7d627';
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END $$;
