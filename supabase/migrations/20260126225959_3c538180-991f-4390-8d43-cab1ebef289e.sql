-- Phase 1: Environment Separation Database Setup

-- 1. Add environment columns to vendors table
ALTER TABLE public.vendors 
ADD COLUMN IF NOT EXISTS is_test_store boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS approved_for_live boolean DEFAULT false;

-- 2. Add environment column to rider_profiles table
ALTER TABLE public.rider_profiles 
ADD COLUMN IF NOT EXISTS is_test_rider boolean DEFAULT false;

-- 3. Add environment column to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS environment text DEFAULT 'production' CHECK (environment IN ('development', 'production'));

-- 4. Add environment column to wallet_transactions table
ALTER TABLE public.wallet_transactions 
ADD COLUMN IF NOT EXISTS environment text DEFAULT 'production' CHECK (environment IN ('development', 'production'));

-- 5. Add test balance columns to wallets table
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS test_balance numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS test_pending_balance numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS test_eligible_balance numeric DEFAULT 0;

-- 6. Add test balance to platform_wallet table
ALTER TABLE public.platform_wallet 
ADD COLUMN IF NOT EXISTS test_balance numeric DEFAULT 0;

-- 7. Create environment_switch_logs table
CREATE TABLE IF NOT EXISTS public.environment_switch_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    switched_by uuid NOT NULL,
    from_environment text NOT NULL,
    to_environment text NOT NULL,
    confirmation_text text NOT NULL,
    ip_address text,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on environment_switch_logs
ALTER TABLE public.environment_switch_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for environment_switch_logs
CREATE POLICY "Super admins can view all switch logs" 
ON public.environment_switch_logs 
FOR SELECT 
USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can insert switch logs" 
ON public.environment_switch_logs 
FOR INSERT 
WITH CHECK (is_super_admin(auth.uid()));

-- 8. Insert default platform environment setting
INSERT INTO public.platform_settings (key, value, description)
VALUES ('platform_environment', 'development', 'Current platform environment: development or production')
ON CONFLICT (key) DO NOTHING;

-- 9. Create get_platform_environment function
CREATE OR REPLACE FUNCTION public.get_platform_environment()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM public.platform_settings WHERE key = 'platform_environment' LIMIT 1
$$;

-- 10. Update vendors RLS policy to filter by environment
DROP POLICY IF EXISTS "Anyone can view active vendors" ON public.vendors;

CREATE POLICY "Anyone can view active vendors" 
ON public.vendors 
FOR SELECT 
USING (
  -- Admins see all vendors
  has_role(auth.uid(), 'admin') OR
  -- Vendor owner sees their own vendor
  (auth.uid() = user_id) OR
  -- In production: only non-test approved stores that are active and verified
  (get_platform_environment() = 'production' AND is_test_store = false AND approved_for_live = true AND is_active = true AND is_verified = true) OR
  -- In development: test stores that are active
  (get_platform_environment() = 'development' AND is_test_store = true AND is_active = true)
);

-- 11. Create index for faster environment queries
CREATE INDEX IF NOT EXISTS idx_vendors_environment ON public.vendors (is_test_store, approved_for_live, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_environment ON public.orders (environment);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_environment ON public.wallet_transactions (environment);