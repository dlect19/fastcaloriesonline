-- Add bank account and withdrawal settings to wallets table
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS bank_name text,
ADD COLUMN IF NOT EXISTS bank_account_number text,
ADD COLUMN IF NOT EXISTS bank_account_name text,
ADD COLUMN IF NOT EXISTS auto_withdraw boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_withdraw_threshold numeric DEFAULT 5000,
ADD COLUMN IF NOT EXISTS auto_withdraw_day integer DEFAULT 1;

-- Create withdrawal_requests table for tracking withdrawal requests
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  bank_name text NOT NULL,
  bank_account_number text NOT NULL,
  bank_account_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  notes text,
  user_type text NOT NULL DEFAULT 'vendor',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on withdrawal_requests
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies for withdrawal_requests
CREATE POLICY "Users can view own withdrawal requests"
ON public.withdrawal_requests
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create withdrawal requests"
ON public.withdrawal_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all withdrawal requests"
ON public.withdrawal_requests
FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);