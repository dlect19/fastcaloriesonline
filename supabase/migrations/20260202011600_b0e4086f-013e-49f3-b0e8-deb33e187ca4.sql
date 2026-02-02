-- =====================================================
-- DELIVERY COMPANY (LOGISTICS PARTNER) SYSTEM
-- =====================================================

-- 1. Add 'delivery_company' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'delivery_company';

-- 2. Create delivery company staff role enum
CREATE TYPE public.delivery_company_staff_role AS ENUM ('owner', 'manager', 'dispatcher');

-- 3. Create delivery_companies table
CREATE TABLE public.delivery_companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL, -- Owner's user ID
  name TEXT NOT NULL,
  logo_url TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  commission_rate NUMERIC NOT NULL DEFAULT 20.00, -- Platform takes 20% of delivery fee
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  bank_account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  paystack_recipient_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. Create delivery_company_staff table
CREATE TABLE public.delivery_company_staff (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_company_id UUID NOT NULL REFERENCES public.delivery_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role delivery_company_staff_role NOT NULL DEFAULT 'dispatcher',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(delivery_company_id, user_id)
);

-- 5. Add delivery_company_id to rider_profiles
ALTER TABLE public.rider_profiles 
ADD COLUMN IF NOT EXISTS delivery_company_id UUID REFERENCES public.delivery_companies(id) ON DELETE SET NULL;

-- 6. Enable RLS
ALTER TABLE public.delivery_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_company_staff ENABLE ROW LEVEL SECURITY;

-- 7. Helper function: Check if user owns delivery company
CREATE OR REPLACE FUNCTION public.owns_delivery_company(_user_id UUID, _company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_companies
    WHERE id = _company_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_company_staff
    WHERE delivery_company_id = _company_id 
      AND user_id = _user_id 
      AND role = 'owner' 
      AND is_active = true
  )
$$;

-- 8. Helper function: Get delivery company staff role
CREATE OR REPLACE FUNCTION public.get_delivery_company_staff_role(_user_id UUID, _company_id UUID)
RETURNS delivery_company_staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.delivery_company_staff
  WHERE user_id = _user_id AND delivery_company_id = _company_id AND is_active = true
  LIMIT 1
$$;

-- 9. Helper function: Check if rider belongs to delivery company
CREATE OR REPLACE FUNCTION public.rider_belongs_to_company(_rider_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT delivery_company_id FROM public.rider_profiles
  WHERE user_id = _rider_user_id AND delivery_company_id IS NOT NULL
  LIMIT 1
$$;

-- 10. RLS Policies for delivery_companies
CREATE POLICY "Admins can manage all delivery companies"
ON public.delivery_companies FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can manage own company"
ON public.delivery_companies FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Staff can view own company"
ON public.delivery_companies FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.delivery_company_staff
  WHERE delivery_company_id = id AND user_id = auth.uid() AND is_active = true
));

CREATE POLICY "Anyone can view verified active companies"
ON public.delivery_companies FOR SELECT
USING (is_verified = true AND is_active = true);

-- 11. RLS Policies for delivery_company_staff
CREATE POLICY "Admins can manage all delivery company staff"
ON public.delivery_company_staff FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Company owners can manage staff"
ON public.delivery_company_staff FOR ALL
USING (owns_delivery_company(auth.uid(), delivery_company_id));

CREATE POLICY "Staff can view own record"
ON public.delivery_company_staff FOR SELECT
USING (user_id = auth.uid());

-- 12. Update updated_at trigger
CREATE TRIGGER update_delivery_companies_updated_at
  BEFORE UPDATE ON public.delivery_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_delivery_company_staff_updated_at
  BEFORE UPDATE ON public.delivery_company_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 13. Create index for faster lookups
CREATE INDEX idx_rider_profiles_delivery_company ON public.rider_profiles(delivery_company_id) WHERE delivery_company_id IS NOT NULL;
CREATE INDEX idx_delivery_company_staff_company ON public.delivery_company_staff(delivery_company_id);
CREATE INDEX idx_delivery_company_staff_user ON public.delivery_company_staff(user_id);

-- =====================================================
-- UPDATE RIDER ASSIGNMENT TRIGGER FOR DELIVERY COMPANIES
-- =====================================================

CREATE OR REPLACE FUNCTION public.credit_rider_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rider_wallet_id UUID;
  v_vendor_wallet_id UUID;
  v_company_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_delivery_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_rider_share_pct NUMERIC := 0.80; -- 80% to rider/vendor/company
  v_is_vendor_affiliated BOOLEAN := false;
  v_delivery_company_id UUID;
  v_company_commission_rate NUMERIC;
  v_rider_profile_id UUID;
  v_vendor_user_id UUID;
  v_company_user_id UUID;
BEGIN
  -- Only run when rider_id changes from NULL to a value AND payment is already paid
  IF NEW.rider_id IS NOT NULL 
     AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
     AND NEW.payment_status = 'paid' 
     AND COALESCE(NEW.delivery_fee, 0) > 0 THEN
    
    -- Check if we already processed rider share for this order (idempotency)
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share', 'delivery_company_share') LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      RETURN NEW; -- Already processed
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    
    -- Get platform wallet
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    -- Check if rider belongs to a delivery company
    SELECT rp.id, rp.delivery_company_id INTO v_rider_profile_id, v_delivery_company_id
    FROM rider_profiles rp
    WHERE rp.user_id = NEW.rider_id;
    
    IF v_delivery_company_id IS NOT NULL THEN
      -- DELIVERY COMPANY FLOW: Credit delivery company wallet
      -- Get company commission rate (platform's cut from delivery fee)
      SELECT dc.user_id, COALESCE(dc.commission_rate, 20) INTO v_company_user_id, v_company_commission_rate
      FROM delivery_companies dc WHERE dc.id = v_delivery_company_id;
      
      -- Calculate splits based on company commission
      v_platform_delivery_share := ROUND(v_delivery_fee * (v_company_commission_rate / 100), 2);
      v_rider_share := v_delivery_fee - v_platform_delivery_share;
      
      -- Get or create delivery company wallet
      SELECT id INTO v_company_wallet_id FROM wallets 
      WHERE user_id = v_company_user_id AND wallet_type = 'delivery_company';
      
      IF v_company_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (v_company_user_id, 'delivery_company')
        RETURNING id INTO v_company_wallet_id;
      END IF;
      
      -- Update delivery company wallet (immediate, no hold period)
      IF v_is_test THEN
        UPDATE wallets 
        SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
            test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share,
            updated_at = NOW()
        WHERE id = v_company_wallet_id;
      ELSE
        UPDATE wallets 
        SET balance = COALESCE(balance, 0) + v_rider_share,
            eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
            total_earned = COALESCE(total_earned, 0) + v_rider_share,
            updated_at = NOW()
        WHERE id = v_company_wallet_id;
      END IF;
      
      -- Insert delivery company share transaction
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes, metadata
      ) VALUES (
        'delivery_company', 'delivery_company_share', 'credit', v_rider_share, NEW.id,
        v_company_wallet_id, NEW.environment, 'completed',
        'Delivery revenue from order #' || NEW.order_number,
        jsonb_build_object('rider_id', NEW.rider_id, 'delivery_company_id', v_delivery_company_id, 'commission_rate', v_company_commission_rate)
      );
      
    ELSE
      -- Check if rider is affiliated with this vendor
      IF v_rider_profile_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM vendor_riders vr
          WHERE vr.rider_profile_id = v_rider_profile_id
            AND vr.vendor_id = NEW.vendor_id
            AND vr.is_active = true
        ) INTO v_is_vendor_affiliated;
      END IF;
      
      -- Standard 80/20 split for non-company riders
      v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
      v_platform_delivery_share := v_delivery_fee - v_rider_share;
      
      IF v_is_vendor_affiliated THEN
        -- VENDOR COLLECTS: Credit rider share to VENDOR wallet instead of rider
        SELECT v.user_id INTO v_vendor_user_id FROM vendors v WHERE v.id = NEW.vendor_id;
        
        -- Get or create vendor wallet
        SELECT id INTO v_vendor_wallet_id FROM wallets 
        WHERE user_id = v_vendor_user_id AND wallet_type = 'vendor';
        
        IF v_vendor_wallet_id IS NULL THEN
          INSERT INTO wallets (user_id, wallet_type)
          VALUES (v_vendor_user_id, 'vendor')
          RETURNING id INTO v_vendor_wallet_id;
        END IF;
        
        -- Update vendor wallet (immediate, no hold period for delivery revenue)
        IF v_is_test THEN
          UPDATE wallets 
          SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
              test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share,
              updated_at = NOW()
          WHERE id = v_vendor_wallet_id;
        ELSE
          UPDATE wallets 
          SET balance = COALESCE(balance, 0) + v_rider_share,
              eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
              total_earned = COALESCE(total_earned, 0) + v_rider_share,
              updated_at = NOW()
          WHERE id = v_vendor_wallet_id;
        END IF;
        
        -- Insert vendor rider share transaction
        INSERT INTO wallet_transactions (
          wallet_type, category, transaction_type, amount, order_id,
          wallet_id, environment, status, notes, metadata
        ) VALUES (
          'vendor', 'vendor_rider_share', 'credit', v_rider_share, NEW.id,
          v_vendor_wallet_id, NEW.environment, 'completed',
          'Delivery revenue from affiliated rider - order #' || NEW.order_number,
          jsonb_build_object('rider_id', NEW.rider_id, 'rider_profile_id', v_rider_profile_id)
        );
        
      ELSE
        -- STANDARD FLOW: Credit rider share to RIDER wallet
        -- Get or create rider wallet
        SELECT id INTO v_rider_wallet_id FROM wallets 
        WHERE user_id = NEW.rider_id AND wallet_type = 'rider';
        
        IF v_rider_wallet_id IS NULL THEN
          INSERT INTO wallets (user_id, wallet_type)
          VALUES (NEW.rider_id, 'rider')
          RETURNING id INTO v_rider_wallet_id;
        END IF;
        
        -- Update rider wallet (immediate, no hold period)
        IF v_is_test THEN
          UPDATE wallets 
          SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
              test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share,
              updated_at = NOW()
          WHERE id = v_rider_wallet_id;
        ELSE
          UPDATE wallets 
          SET balance = COALESCE(balance, 0) + v_rider_share,
              eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
              total_earned = COALESCE(total_earned, 0) + v_rider_share,
              updated_at = NOW()
          WHERE id = v_rider_wallet_id;
        END IF;
        
        -- Insert rider transaction
        INSERT INTO wallet_transactions (
          wallet_type, category, transaction_type, amount, order_id,
          wallet_id, environment, status, notes
        ) VALUES (
          'rider', 'rider_share', 'credit', v_rider_share, NEW.id,
          v_rider_wallet_id, NEW.environment, 'completed',
          'Delivery earnings from order #' || NEW.order_number
        );
      END IF;
    END IF;
    
    -- Update platform wallet with delivery share (always goes to platform)
    IF v_is_test THEN
      UPDATE platform_wallet 
      SET test_balance = COALESCE(test_balance, 0) + v_platform_delivery_share,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    ELSE
      UPDATE platform_wallet 
      SET balance = COALESCE(balance, 0) + v_platform_delivery_share,
          total_earned = COALESCE(total_earned, 0) + v_platform_delivery_share,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    END IF;
    
    -- Insert platform delivery share transaction
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'delivery_commission', 'credit', v_platform_delivery_share, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Delivery commission from order #' || NEW.order_number
    );
    
  END IF;
  
  RETURN NEW;
END;
$function$;

-- =====================================================
-- ADD delivery_company TO wallet_type CHECK
-- =====================================================
-- First check existing constraint and update if needed
DO $$
BEGIN
  -- Try to add the new wallet type
  ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_wallet_type_check;
  ALTER TABLE wallets ADD CONSTRAINT wallets_wallet_type_check 
    CHECK (wallet_type IN ('customer', 'vendor', 'rider', 'delivery_company'));
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Update unique constraint to include delivery_company wallet type
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_user_id_wallet_type_key;
ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_wallet_type_key UNIQUE (user_id, wallet_type);

-- =====================================================
-- ENABLE REALTIME FOR DELIVERY COMPANIES
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_companies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_company_staff;