
-- Fix credit_rider_on_assignment to also credit vendor_rider_share for affiliated riders
CREATE OR REPLACE FUNCTION public.credit_rider_on_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_company_wallet_id UUID;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_delivery_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_rider_share_pct NUMERIC := 0.80;
  v_delivery_company_id UUID;
  v_company_commission_rate NUMERIC;
  v_rider_profile_id UUID;
  v_company_user_id UUID;
  v_affiliated_vendor_id UUID;
  v_vendor_wallet_id UUID;
BEGIN
  IF NEW.rider_id IS NOT NULL 
     AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
     AND NEW.payment_status = 'paid' 
     AND COALESCE(NEW.delivery_fee, 0) > 0 THEN
    
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share', 'delivery_company_share') LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      RETURN NEW;
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    SELECT rp.id, rp.delivery_company_id, rp.affiliated_vendor_id 
    INTO v_rider_profile_id, v_delivery_company_id, v_affiliated_vendor_id
    FROM rider_profiles rp
    WHERE rp.user_id = NEW.rider_id;
    
    IF v_delivery_company_id IS NOT NULL THEN
      -- DELIVERY COMPANY FLOW
      SELECT dc.user_id, COALESCE(dc.commission_rate, 20) INTO v_company_user_id, v_company_commission_rate
      FROM delivery_companies dc WHERE dc.id = v_delivery_company_id;
      
      v_platform_delivery_share := ROUND(v_delivery_fee * (v_company_commission_rate / 100), 2);
      v_rider_share := v_delivery_fee - v_platform_delivery_share;
      
      SELECT id INTO v_company_wallet_id FROM wallets 
      WHERE user_id = v_company_user_id AND wallet_type = 'delivery_company';
      
      IF v_company_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (v_company_user_id, 'delivery_company')
        RETURNING id INTO v_company_wallet_id;
      END IF;
      
      IF v_is_test THEN
        UPDATE wallets SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share, updated_at = NOW()
        WHERE id = v_company_wallet_id;
      ELSE
        UPDATE wallets SET balance = COALESCE(balance, 0) + v_rider_share,
          eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
          total_earned = COALESCE(total_earned, 0) + v_rider_share, updated_at = NOW()
        WHERE id = v_company_wallet_id;
      END IF;
      
      INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes, metadata)
      VALUES ('delivery_company', 'delivery_company_share', 'credit', v_rider_share, NEW.id,
        v_company_wallet_id, NEW.environment, 'completed',
        'Delivery revenue from order #' || NEW.order_number,
        jsonb_build_object('rider_id', NEW.rider_id, 'delivery_company_id', v_delivery_company_id, 'commission_rate', v_company_commission_rate));
      
    ELSE
      -- NON-COMPANY RIDERS: Credit rider's OWN wallet
      v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
      v_platform_delivery_share := v_delivery_fee - v_rider_share;
      
      SELECT id INTO v_rider_wallet_id FROM wallets 
      WHERE user_id = NEW.rider_id AND wallet_type = 'rider';
      
      IF v_rider_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (NEW.rider_id, 'rider')
        RETURNING id INTO v_rider_wallet_id;
      END IF;
      
      IF v_is_test THEN
        UPDATE wallets SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share, updated_at = NOW()
        WHERE id = v_rider_wallet_id;
      ELSE
        UPDATE wallets SET balance = COALESCE(balance, 0) + v_rider_share,
          eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
          total_earned = COALESCE(total_earned, 0) + v_rider_share, updated_at = NOW()
        WHERE id = v_rider_wallet_id;
      END IF;
      
      INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes)
      VALUES ('rider', 'rider_share', 'credit', v_rider_share, NEW.id,
        v_rider_wallet_id, NEW.environment, 'completed',
        'Delivery earnings from order #' || NEW.order_number);

      -- ALSO credit vendor wallet if rider is affiliated with the order's vendor
      IF v_affiliated_vendor_id IS NOT NULL AND v_affiliated_vendor_id = NEW.vendor_id THEN
        SELECT w.id INTO v_vendor_wallet_id FROM wallets w
        JOIN vendors v ON v.user_id = w.user_id
        WHERE v.id = NEW.vendor_id AND w.wallet_type = 'vendor';
        
        IF v_vendor_wallet_id IS NOT NULL THEN
          IF v_is_test THEN
            UPDATE wallets SET test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_rider_share,
              updated_at = NOW()
            WHERE id = v_vendor_wallet_id;
          ELSE
            UPDATE wallets SET rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_rider_share,
              updated_at = NOW()
            WHERE id = v_vendor_wallet_id;
          END IF;
          
          INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
            wallet_id, environment, status, notes)
          VALUES ('vendor', 'vendor_rider_share', 'credit', v_rider_share, NEW.id,
            v_vendor_wallet_id, NEW.environment, 'completed',
            'Rider delivery revenue from order #' || NEW.order_number);
        END IF;
      END IF;
    END IF;
    
    -- Platform delivery commission
    IF v_is_test THEN
      UPDATE platform_wallet SET test_balance = COALESCE(test_balance, 0) + v_platform_delivery_share, updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    ELSE
      UPDATE platform_wallet SET balance = COALESCE(balance, 0) + v_platform_delivery_share,
        total_earned = COALESCE(total_earned, 0) + v_platform_delivery_share, updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    END IF;
    
    INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
      platform_wallet_id, environment, status, notes)
    VALUES ('platform', 'delivery_commission', 'credit', v_platform_delivery_share, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Delivery commission from order #' || NEW.order_number);
    
  END IF;
  
  RETURN NEW;
END;
$$;
