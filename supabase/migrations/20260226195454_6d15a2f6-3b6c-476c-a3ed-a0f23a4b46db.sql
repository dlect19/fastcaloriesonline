
-- Add unique index to prevent duplicate wallet funding per paystack reference
-- This enforces idempotency at the database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_unique_funding 
ON public.wallet_transactions (paystack_reference, category) 
WHERE paystack_reference IS NOT NULL 
  AND category IN ('dva_funding', 'wallet_funding');
