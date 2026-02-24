-- Release the backfilled Ikeja earnings from pending to eligible/withdrawable
DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  
  UPDATE wallets SET 
    menu_earnings_balance = COALESCE(menu_earnings_pending, 0),
    eligible_balance = COALESCE(menu_earnings_pending, 0),
    balance = COALESCE(pending_balance, 0),
    pending_balance = 0,
    menu_earnings_pending = 0
  WHERE id = '86eda6ea-0548-48b2-a3c2-d67240cbc79d';
  
  -- Also update the vendor_share transaction status from pending to completed
  UPDATE wallet_transactions 
  SET status = 'completed',
      notes = REPLACE(COALESCE(notes, ''), '(pending hold period)', '(released - backfill)')
  WHERE wallet_id = '86eda6ea-0548-48b2-a3c2-d67240cbc79d' 
    AND category = 'vendor_share' 
    AND status = 'pending';
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END $$;