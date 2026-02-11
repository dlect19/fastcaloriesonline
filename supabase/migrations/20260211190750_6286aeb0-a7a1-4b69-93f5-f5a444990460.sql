
-- Fix: When payment is processed and a rider is ALREADY assigned, also credit the rider
-- This closes the gap where rider is assigned before payment, so credit_rider_on_assignment skips
CREATE OR REPLACE FUNCTION public.credit_vendor_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Rider-related variables
  v_existing_rider_tx UUID;
  v_delivery_fee NUMERIC;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_rider_share_pct NUMERIC := 0.80;
  v_rider_profile_id UUID;
  v_delivery_company_id UUID;
  v_is_vendor_affiliated BOOLEAN := false;
  v_rider_wallet_id UUID;
  v_company_wallet_id UUID;
  v_company_user_id UUID;
  v_company_commission_rate NUMERIC;
  v_vendor_user_id UUID;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    -- Idempotency check for vendor share
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
    
    v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_commission_rate := COALESCE(v_vendor.commission_rate, 15.00);
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    v_platform_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    v_vendor_share := v_menu_price - v_platform_commission;
    
    v_company_revenue := v_platform_commission + v_service_fee - v_promo_discount;
    
    IF v_company_revenue > 0 THEN
      v_revenue_status := 'profit';
    ELSIF v_company_revenue = 0 THEN
      v_revenue_status := 'break_even';
    ELSE
      v_revenue_status := 'loss';
    END IF;
    
    -- Insert order_financials record
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
    
    -- Update vendor wallet
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
    
    -- Log platform commission
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id, 
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'platform_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Commission from order #' || NEW.order_number
    );
    
    -- Log service fee
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
    
    -- Log promo cost
    IF v_promo_discount > 0 THEN
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'debit', v_promo_discount, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Promo discount absorbed - order #' || NEW.order_number
      );
      
      INSERT INTO daily_promo_stats (stat_date, total_promo_cost, total_revenue, environment)
      VALUES (CURRENT_DATE, v_promo_discount, v_menu_price, NEW.environment)
      ON CONFLICT (stat_date, environment) 
      DO UPDATE SET 
        total_promo_cost = daily_promo_stats.total_promo_cost + v_promo_discount,
        total_revenue = daily_promo_stats.total_revenue + v_menu_price,
        updated_at = now();
    END IF;
    
    -- Vendor share transaction
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'vendor', 'vendor_share', 'credit', v_vendor_share, NEW.id,
      v_vendor_wallet_id, NEW.environment, 'pending',
      'Earnings from order #' || NEW.order_number || ' (pending hold period)'
    );

    -- ============================================
    -- NEW: Also credit rider if already assigned
    -- ============================================
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    
    IF NEW.rider_id IS NOT NULL AND v_delivery_fee > 0 THEN
      -- Check idempotency for rider share
      SELECT id INTO v_existing_rider_tx FROM wallet_transactions 
      WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share', 'delivery_company_share') LIMIT 1;
      
      IF v_existing_rider_tx IS NULL THEN
        -- Get rider profile info
        SELECT rp.id, rp.delivery_company_id INTO v_rider_profile_id, v_delivery_company_id
        FROM rider_profiles rp WHERE rp.user_id = NEW.rider_id;
        
        IF v_delivery_company_id IS NOT NULL THEN
          -- DELIVERY COMPANY FLOW
          SELECT dc.user_id, COALESCE(dc.commission_rate, 20) INTO v_company_user_id, v_company_commission_rate
          FROM delivery_companies dc WHERE dc.id = v_delivery_company_id;
          
          v_platform_delivery_share := ROUND(v_delivery_fee * (v_company_commission_rate / 100), 2);
          v_rider_share := v_delivery_fee - v_platform_delivery_share;
          
          SELECT id INTO v_company_wallet_id FROM wallets 
          WHERE user_id = v_company_user_id AND wallet_type = 'delivery_company';
          
          IF v_company_wallet_id IS NULL THEN
            INSERT INTO wallets (user_id, wallet_type) VALUES (v_company_user_id, 'delivery_company')
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
          -- Check vendor affiliation
          IF v_rider_profile_id IS NOT NULL THEN
            SELECT EXISTS (
              SELECT 1 FROM vendor_riders vr
              WHERE vr.rider_profile_id = v_rider_profile_id AND vr.vendor_id = NEW.vendor_id AND vr.is_active = true
            ) INTO v_is_vendor_affiliated;
          END IF;
          
          v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
          v_platform_delivery_share := v_delivery_fee - v_rider_share;
          
          IF v_is_vendor_affiliated THEN
            -- Credit vendor's rider revenue pool
            SELECT v.user_id INTO v_vendor_user_id FROM vendors v WHERE v.id = NEW.vendor_id;
            
            IF v_is_test THEN
              UPDATE wallets SET test_balance = COALESCE(test_balance, 0) + v_rider_share,
                test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share, updated_at = NOW()
              WHERE id = v_vendor_wallet_id;
            ELSE
              UPDATE wallets SET balance = COALESCE(balance, 0) + v_rider_share,
                eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
                total_earned = COALESCE(total_earned, 0) + v_rider_share, updated_at = NOW()
              WHERE id = v_vendor_wallet_id;
            END IF;
            
            INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
              wallet_id, environment, status, notes, metadata)
            VALUES ('vendor', 'vendor_rider_share', 'credit', v_rider_share, NEW.id,
              v_vendor_wallet_id, NEW.environment, 'completed',
              'Delivery revenue from affiliated rider - order #' || NEW.order_number,
              jsonb_build_object('rider_id', NEW.rider_id, 'rider_profile_id', v_rider_profile_id));
            
          ELSE
            -- Credit rider wallet directly
            SELECT id INTO v_rider_wallet_id FROM wallets 
            WHERE user_id = NEW.rider_id AND wallet_type = 'rider';
            
            IF v_rider_wallet_id IS NULL THEN
              INSERT INTO wallets (user_id, wallet_type) VALUES (NEW.rider_id, 'rider')
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
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$function$;
