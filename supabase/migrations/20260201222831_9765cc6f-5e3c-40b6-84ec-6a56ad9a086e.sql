-- Update the credit_rider_on_assignment trigger to redirect earnings to vendor wallet 
-- when the rider is affiliated with the order's vendor

CREATE OR REPLACE FUNCTION public.credit_rider_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rider_wallet_id UUID;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_delivery_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_rider_share_pct NUMERIC := 0.80; -- 80% to rider/vendor
  v_is_vendor_affiliated BOOLEAN := false;
  v_rider_profile_id UUID;
  v_vendor_user_id UUID;
BEGIN
  -- Only run when rider_id changes from NULL to a value AND payment is already paid
  IF NEW.rider_id IS NOT NULL 
     AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
     AND NEW.payment_status = 'paid' 
     AND COALESCE(NEW.delivery_fee, 0) > 0 THEN
    
    -- Check if we already processed rider share for this order (idempotency)
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share') LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      RETURN NEW; -- Already processed
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
    v_platform_delivery_share := v_delivery_fee - v_rider_share;
    
    -- Check if rider is affiliated with this vendor
    SELECT rp.id INTO v_rider_profile_id
    FROM rider_profiles rp
    WHERE rp.user_id = NEW.rider_id;
    
    IF v_rider_profile_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM vendor_riders vr
        WHERE vr.rider_profile_id = v_rider_profile_id
          AND vr.vendor_id = NEW.vendor_id
          AND vr.is_active = true
      ) INTO v_is_vendor_affiliated;
    END IF;
    
    -- Get platform wallet
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
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