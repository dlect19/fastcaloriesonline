
-- Fix: Add bypass flag to credit_vendor_on_payment trigger
-- This ensures wallet balance updates always go through regardless of calling context

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
  v_packaging_fee NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
  v_existing_rider_tx UUID;
  v_delivery_fee NUMERIC;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_rider_share_pct NUMERIC := 0.80;
  v_rider_profile_id UUID;
  v_delivery_company_id UUID;
  v_rider_wallet_id UUID;
  v_company_wallet_id UUID;
  v_company_user_id UUID;
  v_company_commission_rate NUMERIC;
  v_affiliated_vendor_id UUID;
  v_affiliated_vendor_wallet_id UUID;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    -- Bypass the prevent_direct_balance_update trigger
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN
      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    
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
    v_packaging_fee := COALESCE(NEW.packaging_fee, 0);
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_commission_rate := COALESCE(v_vendor.commission_rate, 15.00);
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    v_platform_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    v_vendor_share := v_menu_price - v_platform_commission + v_packaging_fee;
    
    v_company_revenue := v_platform_commission + v_service_fee - v_promo_discount;
    
    IF v_company_revenue > 0 THEN
      v_revenue_status := 'profit';
    ELSIF v_company_revenue = 0 THEN
      v_revenue_status := 'break_even';
    ELSE
      v_revenue_status := 'loss';
    END IF;
    
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
    
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id, 
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'platform_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Commission from order #' || NEW.order_number
    );
    
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
    
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'vendor', 'vendor_share', 'credit', v_vendor_share, NEW.id,
      v_vendor_wallet_id, NEW.environment, 'pending',
      'Earnings from order #' || NEW.order_number || ' (pending hold period)'
    );

    -- RIDER CREDITING (if rider already assigned at payment time)
    v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
    
    IF NEW.rider_id IS NOT NULL AND v_delivery_fee > 0 THEN
      SELECT id INTO v_existing_rider_tx FROM wallet_transactions 
      WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share', 'delivery_company_share') LIMIT 1;
      
      IF v_existing_rider_tx IS NULL THEN
        SELECT rp.id, rp.delivery_company_id, rp.affiliated_vendor_id 
        INTO v_rider_profile_id, v_delivery_company_id, v_affiliated_vendor_id
        FROM rider_profiles rp WHERE rp.user_id = NEW.rider_id;
        
        IF v_delivery_company_id IS NOT NULL THEN
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
            jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', v_platform_delivery_share, 'company_share', v_rider_share));
          
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
            
        ELSIF v_affiliated_vendor_id IS NOT NULL THEN
          v_platform_delivery_share := ROUND(v_delivery_fee * 0.20, 2);
          v_rider_share := v_delivery_fee - v_platform_delivery_share;
          
          SELECT id INTO v_affiliated_vendor_wallet_id FROM wallets
          WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
            AND wallet_type = 'vendor';
            
          IF v_affiliated_vendor_wallet_id IS NULL THEN
            INSERT INTO wallets (user_id, wallet_type) 
            VALUES ((SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id), 'vendor')
            RETURNING id INTO v_affiliated_vendor_wallet_id;
          END IF;
          
          IF v_is_test THEN
            UPDATE wallets SET 
              test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_rider_share,
              test_balance = COALESCE(test_balance, 0) + v_rider_share,
              test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share,
              updated_at = NOW()
            WHERE id = v_affiliated_vendor_wallet_id;
          ELSE
            UPDATE wallets SET 
              rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_rider_share,
              balance = COALESCE(balance, 0) + v_rider_share,
              eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
              total_earned = COALESCE(total_earned, 0) + v_rider_share,
              updated_at = NOW()
            WHERE id = v_affiliated_vendor_wallet_id;
          END IF;
          
          INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
            wallet_id, environment, status, notes, metadata)
          VALUES ('vendor', 'vendor_rider_share', 'credit', v_rider_share, NEW.id,
            v_affiliated_vendor_wallet_id, NEW.environment, 'completed',
            'Rider delivery revenue from order #' || NEW.order_number,
            jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', v_platform_delivery_share, 'vendor_share', v_rider_share));
          
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
            'Delivery commission from vendor-rider order #' || NEW.order_number);
        ELSE
          v_rider_share := ROUND(v_delivery_fee * v_rider_share_pct, 2);
          v_platform_delivery_share := v_delivery_fee - v_rider_share;
          
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
            wallet_id, environment, status, notes, metadata)
          VALUES ('rider', 'rider_share', 'credit', v_rider_share, NEW.id,
            v_rider_wallet_id, NEW.environment, 'completed',
            'Delivery earnings from order #' || NEW.order_number,
            jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', v_platform_delivery_share, 'rider_share', v_rider_share));
          
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
    
    -- Reset bypass flag
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Also fix credit_rider_on_assignment trigger
CREATE OR REPLACE FUNCTION public.credit_rider_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    
    -- Bypass the prevent_direct_balance_update trigger
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category IN ('rider_share', 'vendor_rider_share', 'delivery_company_share') LIMIT 1;
    
    IF v_existing_tx IS NOT NULL THEN
      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
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
    
    -- Reset bypass flag
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Also fix update_vendor_revenue_pools to set bypass
CREATE OR REPLACE FUNCTION public.update_vendor_revenue_pools()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.wallet_type != 'vendor' THEN
    RETURN NEW;
  END IF;

  -- Bypass the prevent_direct_balance_update trigger
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF NEW.category = 'vendor_share' AND NEW.transaction_type = 'credit' THEN
    IF NEW.environment = 'development' THEN
      UPDATE wallets 
      SET test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets 
      SET menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  IF NEW.category = 'vendor_rider_share' AND NEW.transaction_type = 'credit' THEN
    IF NEW.environment = 'development' THEN
      UPDATE wallets 
      SET test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets 
      SET rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  RETURN NEW;
END;
$function$;
