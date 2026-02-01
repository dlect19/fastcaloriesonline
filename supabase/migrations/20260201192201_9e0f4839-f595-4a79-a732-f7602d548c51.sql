-- Add Paystack customer and DVA columns to wallets table
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS paystack_customer_id bigint,
ADD COLUMN IF NOT EXISTS paystack_customer_code text,
ADD COLUMN IF NOT EXISTS dva_bank_name text,
ADD COLUMN IF NOT EXISTS dva_account_number text,
ADD COLUMN IF NOT EXISTS dva_account_name text,
ADD COLUMN IF NOT EXISTS dva_active boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS dva_created_at timestamp with time zone;

-- Add index for faster lookup by paystack_customer_code (used in webhook)
CREATE INDEX IF NOT EXISTS idx_wallets_paystack_customer_code ON public.wallets(paystack_customer_code) WHERE paystack_customer_code IS NOT NULL;