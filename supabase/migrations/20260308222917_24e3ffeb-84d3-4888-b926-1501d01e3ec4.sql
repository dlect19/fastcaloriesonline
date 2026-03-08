
-- Add balance_after column to wallet_transactions
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC DEFAULT NULL;

-- Create trigger function to auto-populate balance_after on insert
CREATE OR REPLACE FUNCTION public.set_balance_after_on_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_balance NUMERIC;
BEGIN
  -- Only populate for wallet-based transactions (not platform_wallet)
  IF NEW.wallet_id IS NOT NULL THEN
    SELECT COALESCE(balance, 0) INTO v_current_balance
    FROM wallets
    WHERE id = NEW.wallet_id;
    
    NEW.balance_after := v_current_balance;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger (BEFORE INSERT so we can modify NEW)
DROP TRIGGER IF EXISTS trg_set_balance_after ON wallet_transactions;
CREATE TRIGGER trg_set_balance_after
  BEFORE INSERT ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION set_balance_after_on_transaction();
