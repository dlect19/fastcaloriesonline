
-- Drop the old constraint that prevents multi-outlet wallets
ALTER TABLE wallets DROP CONSTRAINT wallets_user_id_wallet_type_key;

-- Add new unique constraint that includes outlet_id
-- Use a unique index with COALESCE to handle NULL outlet_id
CREATE UNIQUE INDEX wallets_user_id_wallet_type_outlet_id_key 
ON wallets (user_id, wallet_type, COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'));

-- Now fix the misrouted Ikeja order data
DO $$
DECLARE
  v_vendor_user_id UUID;
  v_ikeja_wallet_id UUID;
  v_main_wallet_id UUID := 'dda25eae-766b-4815-9f14-b79ffbbf9bad';
  v_ikeja_outlet_id UUID := 'a4acafaf-614c-40b2-af93-5563b83414f2';
  v_amount NUMERIC := 335.00;
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  
  SELECT v.user_id INTO v_vendor_user_id 
  FROM vendors v 
  JOIN vendor_outlets vo ON vo.vendor_id = v.id 
  WHERE vo.id = v_ikeja_outlet_id;
  
  -- Create Ikeja outlet wallet
  INSERT INTO wallets (user_id, wallet_type, outlet_id, pending_balance, menu_earnings_pending, total_earned)
  VALUES (v_vendor_user_id, 'vendor', v_ikeja_outlet_id, v_amount, v_amount, v_amount)
  RETURNING id INTO v_ikeja_wallet_id;
  
  -- Deduct from Main Outlet wallet
  UPDATE wallets SET
    pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_amount, 0),
    menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - v_amount, 0),
    total_earned = GREATEST(COALESCE(total_earned, 0) - v_amount, 0)
  WHERE id = v_main_wallet_id;
  
  -- Re-point the wallet transaction to the correct wallet
  UPDATE wallet_transactions 
  SET wallet_id = v_ikeja_wallet_id
  WHERE id = 'a246026d-b808-4766-9eb2-090a969f8cc9';
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END $$;
