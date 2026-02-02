-- Phase 1: Add order_financials table for per-order audit trail
CREATE TABLE IF NOT EXISTS public.order_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_price NUMERIC NOT NULL,
  vendor_commission_percentage NUMERIC NOT NULL,
  vendor_commission_amount NUMERIC NOT NULL,
  promo_discount_amount NUMERIC NOT NULL DEFAULT 0,
  promo_type TEXT,
  promo_source TEXT,
  vendor_payout NUMERIC NOT NULL,
  company_revenue NUMERIC NOT NULL,
  revenue_status TEXT NOT NULL DEFAULT 'profit',
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add menu_subtotal column to orders for tracking original price before discount
ALTER TABLE orders ADD COLUMN IF NOT EXISTS menu_subtotal NUMERIC;

-- Enable RLS on order_financials
ALTER TABLE order_financials ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage order_financials
CREATE POLICY "Admins can manage order financials"
ON order_financials FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Vendors can view financials for their orders (read-only, limited fields)
CREATE POLICY "Vendors can view own order financials"
ON order_financials FOR SELECT
USING (EXISTS (
  SELECT 1 FROM orders o
  JOIN vendors v ON o.vendor_id = v.id
  WHERE o.id = order_financials.order_id 
  AND v.user_id = auth.uid()
));

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_order_financials_order_id ON order_financials(order_id);
CREATE INDEX IF NOT EXISTS idx_order_financials_environment ON order_financials(environment);
CREATE INDEX IF NOT EXISTS idx_order_financials_revenue_status ON order_financials(revenue_status);

-- Update credit_vendor_on_payment trigger to use full menu price for commission
CREATE OR REPLACE FUNCTION public.credit_vendor_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor RECORD;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_commission_rate NUMERIC;
  v_platform_commission NUMERIC;
  v_vendor_share NUMERIC;
  v_service_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_menu_price NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    -- Idempotency check
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN RETURN NEW; END IF;
    
    v_is_test := (NEW.environment = 'development');
    
    -- Get vendor info
    SELECT v.*, w.id as wallet_id INTO v_vendor
    FROM vendors v
    LEFT JOIN wallets w ON w.user_id = v.user_id AND w.wallet_type = 'vendor'
    WHERE v.id = NEW.vendor_id;
    
    IF v_vendor.wallet_id IS NULL THEN
      INSERT INTO wallets (user_id, wallet_type)
      VALUES (v_vendor.user_id, 'vendor')
      RETURNING id INTO v_vendor_wallet_id;
    ELSE
      v_vendor_wallet_id := v_vendor.wallet_id;
    END IF;
    
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    -- CRITICAL: Use menu_subtotal (full price) not discounted subtotal
    -- Fallback: if menu_subtotal is NULL, reconstruct from subtotal + discount
    v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_commission_rate := COALESCE(v_vendor.commission_rate, 15.00);
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    -- Calculate commission on FULL menu price (Platform Absorbs Loss model)
    v_platform_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    v_vendor_share := v_menu_price - v_platform_commission;
    
    -- Calculate net company revenue (can be negative = loss)
    v_company_revenue := v_platform_commission + v_service_fee - v_promo_discount;
    
    IF v_company_revenue > 0 THEN
      v_revenue_status := 'profit';
    ELSIF v_company_revenue = 0 THEN
      v_revenue_status := 'break_even';
    ELSE
      v_revenue_status := 'loss';
    END IF;
    
    -- Insert order_financials record for audit
    INSERT INTO order_financials (
      order_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
      promo_discount_amount, promo_type, promo_source, vendor_payout, 
      company_revenue, revenue_status, environment
    ) VALUES (
      NEW.id, v_menu_price, v_commission_rate, v_platform_commission,
      v_promo_discount, 
      CASE WHEN NEW.promo_code IS NOT NULL THEN 'promo_code' ELSE NULL END,
      NEW.promo_code,
      v_vendor_share, v_company_revenue, v_revenue_status, NEW.environment
    );
    
    -- Update platform wallet with commission (full commission, promo is absorbed separately)
    IF v_is_test THEN
      UPDATE platform_wallet 
      SET test_balance = COALESCE(test_balance, 0) + v_platform_commission + v_service_fee,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    ELSE
      UPDATE platform_wallet 
      SET balance = COALESCE(balance, 0) + v_platform_commission + v_service_fee,
          total_earned = COALESCE(total_earned, 0) + v_platform_commission + v_service_fee,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    END IF;
    
    -- Update vendor wallet (ALWAYS gets full share - unaffected by promos)
    IF v_is_test THEN
      UPDATE wallets 
      SET test_pending_balance = COALESCE(test_pending_balance, 0) + v_vendor_share,
          updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
    ELSE
      UPDATE wallets 
      SET pending_balance = COALESCE(pending_balance, 0) + v_vendor_share,
          total_earned = COALESCE(total_earned, 0) + v_vendor_share,
          updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
    END IF;
    
    -- Log transactions for audit
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id, 
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'platform_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Commission from order #' || NEW.order_number
    );
    
    -- Log service fee if present
    IF v_service_fee > 0 THEN
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'service_fee', 'credit', v_service_fee, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Service fee from order #' || NEW.order_number
      );
    END IF;
    
    -- Log promo as platform cost (debit) if applicable - Platform Absorbs Loss
    IF v_promo_discount > 0 THEN
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'debit', v_promo_discount, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Promo discount absorbed - order #' || NEW.order_number
      );
      
      -- Update daily promo stats
      INSERT INTO daily_promo_stats (stat_date, total_promo_cost, total_revenue, environment)
      VALUES (CURRENT_DATE, v_promo_discount, v_menu_price, NEW.environment)
      ON CONFLICT (stat_date, environment) 
      DO UPDATE SET 
        total_promo_cost = daily_promo_stats.total_promo_cost + v_promo_discount,
        total_revenue = daily_promo_stats.total_revenue + v_menu_price,
        updated_at = now();
    END IF;
    
    -- Vendor share transaction (pending hold period)
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'vendor', 'vendor_share', 'credit', v_vendor_share, NEW.id,
      v_vendor_wallet_id, NEW.environment, 'pending',
      'Earnings from order #' || NEW.order_number || ' (pending hold period)'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Add unique constraint to daily_promo_stats for upsert
ALTER TABLE daily_promo_stats DROP CONSTRAINT IF EXISTS daily_promo_stats_date_env_unique;
ALTER TABLE daily_promo_stats ADD CONSTRAINT daily_promo_stats_date_env_unique UNIQUE (stat_date, environment);