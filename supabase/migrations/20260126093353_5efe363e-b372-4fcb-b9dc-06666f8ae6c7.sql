-- ============================================
-- WALLET & PAYOUT SYSTEM - COMPREHENSIVE SCHEMA
-- ============================================

-- Add wallet_type to existing wallets table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'wallet_type') THEN
    ALTER TABLE public.wallets ADD COLUMN wallet_type text DEFAULT 'customer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'eligible_balance') THEN
    ALTER TABLE public.wallets ADD COLUMN eligible_balance numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'pending_payouts') THEN
    ALTER TABLE public.wallets ADD COLUMN pending_payouts numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'paystack_recipient_code') THEN
    ALTER TABLE public.wallets ADD COLUMN paystack_recipient_code text;
  END IF;
END $$;

-- Create platform_wallet table (single record for platform master wallet)
CREATE TABLE IF NOT EXISTS public.platform_wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance numeric DEFAULT 0,
  currency text DEFAULT 'NGN',
  total_earned numeric DEFAULT 0,
  total_paid_out numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.platform_wallet ENABLE ROW LEVEL SECURITY;

-- Platform wallet can only be accessed by admins
CREATE POLICY "Only admins can view platform wallet" ON public.platform_wallet
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update platform wallet" ON public.platform_wallet
  FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert initial platform wallet record if not exists
INSERT INTO public.platform_wallet (id) 
SELECT gen_random_uuid() 
WHERE NOT EXISTS (SELECT 1 FROM public.platform_wallet);

-- Create wallet_transactions table (detailed transaction log)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE CASCADE,
  platform_wallet_id uuid REFERENCES public.platform_wallet(id),
  wallet_type text NOT NULL, -- platform, vendor, rider, customer
  transaction_type text NOT NULL, -- credit, debit
  category text NOT NULL, -- order_payment, vendor_share, rider_share, platform_commission, withdrawal, refund, cashback, transfer
  amount numeric NOT NULL,
  balance_after numeric,
  reference text,
  paystack_reference text,
  order_id uuid REFERENCES public.orders(id),
  related_wallet_id uuid,
  status text DEFAULT 'completed', -- pending, completed, failed, reversed
  metadata jsonb DEFAULT '{}',
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own wallet transactions
CREATE POLICY "Users can view own wallet transactions" ON public.wallet_transactions
  FOR SELECT USING (
    wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Admins can manage all transactions
CREATE POLICY "Admins can manage all transactions" ON public.wallet_transactions
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Create paystack_recipients table (store transfer recipient codes)
CREATE TABLE IF NOT EXISTS public.paystack_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE CASCADE,
  bank_code text NOT NULL,
  account_number text NOT NULL,
  account_name text NOT NULL,
  recipient_code text NOT NULL,
  is_verified boolean DEFAULT false,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.paystack_recipients ENABLE ROW LEVEL SECURITY;

-- Users can manage their own recipients
CREATE POLICY "Users can view own recipients" ON public.paystack_recipients
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recipients" ON public.paystack_recipients
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recipients" ON public.paystack_recipients
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recipients" ON public.paystack_recipients
  FOR DELETE USING (auth.uid() = user_id);

-- Admins can view all recipients
CREATE POLICY "Admins can view all recipients" ON public.paystack_recipients
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Create payout_requests table (track withdrawal/payout requests)
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_type text NOT NULL, -- vendor, rider
  amount numeric NOT NULL,
  status text DEFAULT 'pending', -- pending, processing, completed, failed, cancelled
  paystack_transfer_code text,
  paystack_reference text,
  recipient_id uuid REFERENCES public.paystack_recipients(id),
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  failure_reason text,
  retry_count integer DEFAULT 0,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own payout requests
CREATE POLICY "Users can view own payout requests" ON public.payout_requests
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own payout requests
CREATE POLICY "Users can create own payout requests" ON public.payout_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can manage all payout requests
CREATE POLICY "Admins can manage all payout requests" ON public.payout_requests
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Create platform_settings table (store configurable values)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read settings
CREATE POLICY "Anyone can read platform settings" ON public.platform_settings
  FOR SELECT USING (true);

-- Only admins can modify settings
CREATE POLICY "Admins can manage platform settings" ON public.platform_settings
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default settings
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('default_vendor_commission_rate', '15', 'Default commission percentage for vendors'),
  ('default_rider_share_percentage', '80', 'Percentage of delivery fee that goes to rider'),
  ('min_withdrawal_amount', '1000', 'Minimum amount for withdrawals in Naira'),
  ('auto_payout_enabled', 'true', 'Whether automated payouts are enabled'),
  ('vendor_earnings_hold_hours', '24', 'Hours to hold vendor earnings before becoming eligible'),
  ('rider_earnings_hold_hours', '0', 'Hours to hold rider earnings before becoming eligible')
ON CONFLICT (key) DO NOTHING;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON public.wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order_id ON public.wallet_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_requests_wallet_id ON public.payout_requests(wallet_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_paystack_recipients_user_id ON public.paystack_recipients(user_id);

-- Add trigger for updating updated_at on payout_requests
CREATE OR REPLACE TRIGGER update_payout_requests_updated_at
  BEFORE UPDATE ON public.payout_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for updating updated_at on platform_settings
CREATE OR REPLACE TRIGGER update_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for updating updated_at on paystack_recipients
CREATE OR REPLACE TRIGGER update_paystack_recipients_updated_at
  BEFORE UPDATE ON public.paystack_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for updating updated_at on platform_wallet
CREATE OR REPLACE TRIGGER update_platform_wallet_updated_at
  BEFORE UPDATE ON public.platform_wallet
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();