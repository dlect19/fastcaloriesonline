-- =============================================
-- LEDGER SYSTEM: Automatic wallet crediting
-- =============================================

-- Helper function to credit vendor wallet when payment is confirmed
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
BEGIN
  -- Only run when payment_status changes to 'paid'
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    -- Check if we already processed this order (idempotency)
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      RETURN NEW; -- Already processed
    END IF;
    
    -- Determine if this is a test transaction
    v_is_test := (NEW.environment = 'development');
    
    -- Get vendor info
    SELECT v.*, w.id as wallet_id INTO v_vendor
    FROM vendors v
    LEFT JOIN wallets w ON w.user_id = v.user_id AND w.wallet_type = 'vendor'
    WHERE v.id = NEW.vendor_id;
    
    IF v_vendor.wallet_id IS NULL THEN
      -- Create vendor wallet if missing
      INSERT INTO wallets (user_id, wallet_type)
      VALUES (v_vendor.user_id, 'vendor')
      RETURNING id INTO v_vendor_wallet_id;
    ELSE
      v_vendor_wallet_id := v_vendor.wallet_id;
    END IF;
    
    -- Get platform wallet
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    -- Calculate splits
    v_commission_rate := COALESCE(v_vendor.commission_rate, 15.00);
    v_platform_commission := ROUND(NEW.subtotal * (v_commission_rate / 100), 2);
    v_vendor_share := NEW.subtotal - v_platform_commission;
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    -- Update platform wallet
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
    
    -- Update vendor wallet (pending balance - available after hold period)
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
    
    -- Insert wallet transaction records
    -- Platform commission
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id, 
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'platform_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Commission from order #' || NEW.order_number
    );
    
    -- Service fee to platform
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
    
    -- Vendor share (pending)
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

-- Helper function to credit rider wallet when assigned to a paid order
CREATE OR REPLACE FUNCTION public.credit_rider_on_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_delivery_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_rider_share_pct NUMERIC := 0.80; -- 80% to rider
BEGIN
  -- Only run when rider_id changes from NULL to a value AND payment is already paid
  IF NEW.rider_id IS NOT NULL 
     AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
     AND NEW.payment_status = 'paid' 
     AND COALESCE(NEW.delivery_fee, 0) > 0 THEN
    
    -- Check if we already processed rider share for this order (idempotency)
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'rider_share' LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      RETURN NEW; -- Already processed
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
    v_platform_delivery_share := v_delivery_fee - v_rider_share;
    
    -- Get or create rider wallet
    SELECT id INTO v_rider_wallet_id FROM wallets 
    WHERE user_id = NEW.rider_id AND wallet_type = 'rider';
    
    IF v_rider_wallet_id IS NULL THEN
      INSERT INTO wallets (user_id, wallet_type)
      VALUES (NEW.rider_id, 'rider')
      RETURNING id INTO v_rider_wallet_id;
    END IF;
    
    -- Get platform wallet
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
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
    
    -- Update platform wallet with delivery share
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
    
    -- Insert rider transaction
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'rider', 'rider_share', 'credit', v_rider_share, NEW.id,
      v_rider_wallet_id, NEW.environment, 'completed',
      'Delivery earnings from order #' || NEW.order_number
    );
    
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
$$;

-- Create the triggers
DROP TRIGGER IF EXISTS trigger_credit_vendor_on_payment ON orders;
CREATE TRIGGER trigger_credit_vendor_on_payment
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_vendor_on_payment();

DROP TRIGGER IF EXISTS trigger_credit_rider_on_assignment ON orders;
CREATE TRIGGER trigger_credit_rider_on_assignment
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_rider_on_assignment();

-- Also trigger vendor credit on INSERT if payment is already paid (e.g., webhook race condition)
DROP TRIGGER IF EXISTS trigger_credit_vendor_on_payment_insert ON orders;
CREATE TRIGGER trigger_credit_vendor_on_payment_insert
  AFTER INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION public.credit_vendor_on_payment();