
-- Drop the dangerously permissive UPDATE policy
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;

-- Create a restricted UPDATE policy that only allows updating non-financial fields
-- Balance changes MUST happen via server-side triggers or edge functions with service role
CREATE POLICY "Users can update own wallet settings"
ON public.wallets
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create a trigger function to prevent direct balance manipulation from client
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the update is coming from a regular user (not service role / trigger),
  -- block any changes to financial columns by reverting them to OLD values
  IF current_setting('role', true) != 'service_role' 
     AND current_setting('request.jwt.claims', true) IS NOT NULL THEN
    
    -- Revert all financial columns to their original values
    NEW.balance := OLD.balance;
    NEW.test_balance := OLD.test_balance;
    NEW.pending_balance := OLD.pending_balance;
    NEW.test_pending_balance := OLD.test_pending_balance;
    NEW.total_earned := OLD.total_earned;
    NEW.total_withdrawn := OLD.total_withdrawn;
    NEW.eligible_balance := OLD.eligible_balance;
    NEW.test_eligible_balance := OLD.test_eligible_balance;
    NEW.pending_payouts := OLD.pending_payouts;
    NEW.menu_earnings_balance := OLD.menu_earnings_balance;
    NEW.menu_earnings_pending := OLD.menu_earnings_pending;
    NEW.rider_revenue_balance := OLD.rider_revenue_balance;
    NEW.test_menu_earnings_balance := OLD.test_menu_earnings_balance;
    NEW.test_menu_earnings_pending := OLD.test_menu_earnings_pending;
    NEW.test_rider_revenue_balance := OLD.test_rider_revenue_balance;
    
    -- Also prevent users from enabling/disabling their own wallet (admin only)
    NEW.is_disabled := OLD.is_disabled;
    
    -- Prevent manipulation of DVA/Paystack fields
    NEW.paystack_customer_id := OLD.paystack_customer_id;
    NEW.paystack_customer_code := OLD.paystack_customer_code;
    NEW.paystack_recipient_code := OLD.paystack_recipient_code;
    NEW.dva_bank_name := OLD.dva_bank_name;
    NEW.dva_account_number := OLD.dva_account_number;
    NEW.dva_account_name := OLD.dva_account_name;
    NEW.dva_active := OLD.dva_active;
    NEW.dva_created_at := OLD.dva_created_at;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach the trigger BEFORE UPDATE so it runs before any RLS check
DROP TRIGGER IF EXISTS prevent_balance_manipulation ON public.wallets;
CREATE TRIGGER prevent_balance_manipulation
BEFORE UPDATE ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.prevent_direct_balance_update();

-- Also ensure wallet_transactions cannot be inserted by regular users
-- (they should only be created by server-side triggers/functions)
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.wallet_transactions;

-- Verify: users should only be able to VIEW their transactions, never create/modify
-- The existing policies are:
-- "Users can view own wallet transactions" (SELECT) ✓
-- "Admins can manage all transactions" (ALL) ✓
-- No INSERT policy for regular users = correct ✓
