
-- Update credit_rider_on_assignment to calculate hybrid payout inline for manual assignments
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
  v_delivery_company_id UUID;
  v_rider_profile_id UUID;
  v_company_user_id UUID;
  v_affiliated_vendor_id UUID;
  v_vendor_wallet_id UUID;
  v_payout_final_pay NUMERIC;
  v_payout_platform_fee NUMERIC;
  v_commission_rate NUMERIC;
  -- Hybrid payout inline vars
  v_fee_pct NUMERIC;
  v_fee_min NUMERIC;
  v_fee_max NUMERIC;
  v_min_payout NUMERIC;
  v_raw_platform_fee NUMERIC;
BEGIN
  IF NEW.rider_id IS NOT NULL 
     AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
     AND NEW.payment_status = 'paid' 
     AND COALESCE(NEW.delivery_fee, 0) > 0 THEN
    
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
      -- Delivery company rider: use resolve_commission_rate
      v_commission_rate := resolve_commission_rate('logistics', v_delivery_company_id);
      SELECT dc.user_id INTO v_company_user_id
      FROM delivery_companies dc WHERE dc.id = v_delivery_company_id;
      
      v_platform_delivery_share := ROUND(v_delivery_fee * (v_commission_rate / 100), 2);
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
        jsonb_build_object('rider_id', NEW.rider_id, 'delivery_company_id', v_delivery_company_id, 'commission_rate', v_commission_rate));
      
      UPDATE order_financials SET
        logistics_commission_percentage = v_commission_rate,
        logistics_commission_amount = v_platform_delivery_share
      WHERE order_id = NEW.id;

    ELSIF v_affiliated_vendor_id IS NOT NULL THEN
      -- Vendor-affiliated rider: use hybrid payout model
      SELECT rpd.final_rider_pay, rpd.platform_fee
      INTO v_payout_final_pay, v_payout_platform_fee
      FROM rider_payout_details rpd
      WHERE rpd.order_id = NEW.id
      LIMIT 1;
      
      IF v_payout_final_pay IS NOT NULL AND v_payout_final_pay > 0 THEN
        v_rider_share := v_payout_final_pay;
        v_platform_delivery_share := COALESCE(v_payout_platform_fee, v_delivery_fee - v_rider_share);
        v_commission_rate := CASE WHEN v_delivery_fee > 0 
          THEN ROUND((v_platform_delivery_share / v_delivery_fee) * 100, 2)
          ELSE 0 END;
      ELSE
        -- Inline hybrid calculation for manual assignments (no dispatch data)
        SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_pct'), 20) INTO v_fee_pct;
        SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_min'), 300) INTO v_fee_min;
        SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_max'), 700) INTO v_fee_max;
        SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_min_payout'), 900) INTO v_min_payout;
        
        -- Calculate platform fee with min/max caps
        v_raw_platform_fee := ROUND(v_delivery_fee * (v_fee_pct / 100), 2);
        v_platform_delivery_share := GREATEST(v_fee_min, LEAST(v_raw_platform_fee, v_fee_max));
        -- Ensure platform fee doesn't exceed delivery fee
        v_platform_delivery_share := LEAST(v_platform_delivery_share, v_delivery_fee);
        
        v_rider_share := v_delivery_fee - v_platform_delivery_share;
        
        -- Apply minimum payout guarantee
        IF v_rider_share < v_min_payout THEN
          v_rider_share := v_min_payout;
          v_platform_delivery_share := v_delivery_fee - v_rider_share;
          -- Platform absorbs cost if negative
        END IF;
        
        v_commission_rate := CASE WHEN v_delivery_fee > 0 
          THEN ROUND((GREATEST(v_platform_delivery_share, 0) / v_delivery_fee) * 100, 2)
          ELSE 0 END;
      END IF;
      
      -- Get/create vendor wallet for the affiliated vendor
      IF NEW.outlet_id IS NOT NULL THEN
        SELECT id INTO v_vendor_wallet_id FROM wallets
        WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
          AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;
        
        IF v_vendor_wallet_id IS NULL THEN
          INSERT INTO wallets (user_id, wallet_type, outlet_id) 
          VALUES ((SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id), 'vendor', NEW.outlet_id)
          RETURNING id INTO v_vendor_wallet_id;
        END IF;
      ELSE
        SELECT id INTO v_vendor_wallet_id FROM wallets
        WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
          AND wallet_type = 'vendor' AND outlet_id IS NULL;
          
        IF v_vendor_wallet_id IS NULL THEN
          INSERT INTO wallets (user_id, wallet_type) 
          VALUES ((SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id), 'vendor')
          RETURNING id INTO v_vendor_wallet_id;
        END IF;
      END IF;
      
      IF v_is_test THEN
        UPDATE wallets SET 
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_rider_share,
          test_balance = COALESCE(test_balance, 0) + v_rider_share,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_rider_share,
          updated_at = NOW()
        WHERE id = v_vendor_wallet_id;
      ELSE
        UPDATE wallets SET 
          rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_rider_share,
          balance = COALESCE(balance, 0) + v_rider_share,
          eligible_balance = COALESCE(eligible_balance, 0) + v_rider_share,
          total_earned = COALESCE(total_earned, 0) + v_rider_share,
          updated_at = NOW()
        WHERE id = v_vendor_wallet_id;
      END IF;
      
      INSERT INTO wallet_transactions (wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes, metadata)
      VALUES ('vendor', 'vendor_rider_share', 'credit', v_rider_share, NEW.id,
        v_vendor_wallet_id, NEW.environment, 'completed',
        'Rider delivery revenue from order #' || NEW.order_number,
        jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', GREATEST(v_platform_delivery_share, 0), 'vendor_share', v_rider_share));
      
      IF v_platform_delivery_share > 0 THEN
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
      END IF;
      
      UPDATE order_financials SET
        rider_commission_percentage = v_commission_rate,
        rider_commission_amount = GREATEST(v_platform_delivery_share, 0)
      WHERE order_id = NEW.id;

    ELSE
      -- Platform/independent rider: use hybrid payout model
      SELECT rpd.final_rider_pay, rpd.platform_fee
      INTO v_payout_final_pay, v_payout_platform_fee
      FROM rider_payout_details rpd
      WHERE rpd.order_id = NEW.id
      LIMIT 1;
      
      IF v_payout_final_pay IS NOT NULL AND v_payout_final_pay > 0 THEN
        v_rider_share := v_payout_final_pay;
        v_platform_delivery_share := COALESCE(v_payout_platform_fee, v_delivery_fee - v_rider_share);
        v_commission_rate := CASE WHEN v_delivery_fee > 0 
          THEN ROUND((v_platform_delivery_share / v_delivery_fee) * 100, 2)
          ELSE 0 END;
      ELSE
        v_commission_rate := resolve_commission_rate('rider', v_rider_profile_id);
        v_platform_delivery_share := ROUND(v_delivery_fee * (v_commission_rate / 100), 2);
        v_rider_share := v_delivery_fee - v_platform_delivery_share;
      END IF;
      
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
      
      UPDATE order_financials SET
        rider_commission_percentage = v_commission_rate,
        rider_commission_amount = v_platform_delivery_share
      WHERE order_id = NEW.id;
    END IF;
    
    IF v_platform_delivery_share > 0 AND v_delivery_company_id IS NULL AND v_affiliated_vendor_id IS NULL THEN
      NULL; -- already handled above
    END IF;
    
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Also update credit_vendor_on_payment for the same inline hybrid calculation
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
  v_rider_profile_id UUID;
  v_delivery_company_id UUID;
  v_rider_wallet_id UUID;
  v_company_wallet_id UUID;
  v_company_user_id UUID;
  v_affiliated_vendor_id UUID;
  v_affiliated_vendor_wallet_id UUID;
  v_rider_commission_rate NUMERIC;
  v_logistics_commission_rate NUMERIC;
  v_payout_final_pay NUMERIC;
  v_payout_platform_fee NUMERIC;
  -- Hybrid payout inline vars
  v_fee_pct NUMERIC;
  v_fee_min NUMERIC;
  v_fee_max NUMERIC;
  v_min_payout NUMERIC;
  v_raw_platform_fee NUMERIC;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN
      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;
    
    v_is_test := (NEW.environment = 'development');
    
    SELECT v.user_id INTO v_vendor
    FROM vendors v
    WHERE v.id = NEW.vendor_id;
    
    IF NEW.outlet_id IS NOT NULL THEN
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;
      
      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type, outlet_id)
        VALUES (v_vendor.user_id, 'vendor', NEW.outlet_id)
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    ELSE
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id IS NULL;
      
      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (v_vendor.user_id, 'vendor')
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    END IF;
    
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
    v_packaging_fee := COALESCE(NEW.packaging_fee, 0);
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    v_commission_rate := resolve_commission_rate('vendor', NEW.vendor_id);
    
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
    
    v_rider_commission_rate := NULL;
    v_logistics_commission_rate := NULL;
    
    INSERT INTO order_financials (
      order_id, outlet_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
      promo_discount_amount, promo_type, promo_source, vendor_payout, 
      company_revenue, revenue_status, environment, service_fee_amount
    ) VALUES (
      NEW.id, NEW.outlet_id, v_menu_price, v_commission_rate, v_platform_commission,
      v_promo_discount, 
      CASE WHEN NEW.promo_code IS NOT NULL THEN 'promo_code' ELSE NULL END,
      NEW.promo_code,
      v_vendor_share, v_company_revenue, v_revenue_status, NEW.environment,
      v_service_fee
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
          v_logistics_commission_rate := resolve_commission_rate('logistics', v_delivery_company_id);
          SELECT dc.user_id INTO v_company_user_id
          FROM delivery_companies dc WHERE dc.id = v_delivery_company_id;
          
          v_platform_delivery_share := ROUND(v_delivery_fee * (v_logistics_commission_rate / 100), 2);
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
          
          UPDATE order_financials SET
            logistics_commission_percentage = v_logistics_commission_rate,
            logistics_commission_amount = v_platform_delivery_share
          WHERE order_id = NEW.id;
            
        ELSIF v_affiliated_vendor_id IS NOT NULL THEN
          -- Vendor-affiliated rider: use hybrid payout model
          SELECT rpd.final_rider_pay, rpd.platform_fee
          INTO v_payout_final_pay, v_payout_platform_fee
          FROM rider_payout_details rpd
          WHERE rpd.order_id = NEW.id
          LIMIT 1;
          
          IF v_payout_final_pay IS NOT NULL AND v_payout_final_pay > 0 THEN
            v_rider_share := v_payout_final_pay;
            v_platform_delivery_share := COALESCE(v_payout_platform_fee, v_delivery_fee - v_rider_share);
            v_rider_commission_rate := CASE WHEN v_delivery_fee > 0 
              THEN ROUND((v_platform_delivery_share / v_delivery_fee) * 100, 2)
              ELSE 0 END;
          ELSE
            -- Inline hybrid calculation for manual assignments
            SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_pct'), 20) INTO v_fee_pct;
            SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_min'), 300) INTO v_fee_min;
            SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_platform_fee_max'), 700) INTO v_fee_max;
            SELECT COALESCE((SELECT value::NUMERIC FROM platform_settings WHERE key = 'rider_min_payout'), 900) INTO v_min_payout;
            
            v_raw_platform_fee := ROUND(v_delivery_fee * (v_fee_pct / 100), 2);
            v_platform_delivery_share := GREATEST(v_fee_min, LEAST(v_raw_platform_fee, v_fee_max));
            v_platform_delivery_share := LEAST(v_platform_delivery_share, v_delivery_fee);
            
            v_rider_share := v_delivery_fee - v_platform_delivery_share;
            
            IF v_rider_share < v_min_payout THEN
              v_rider_share := v_min_payout;
              v_platform_delivery_share := v_delivery_fee - v_rider_share;
            END IF;
            
            v_rider_commission_rate := CASE WHEN v_delivery_fee > 0 
              THEN ROUND((GREATEST(v_platform_delivery_share, 0) / v_delivery_fee) * 100, 2)
              ELSE 0 END;
          END IF;
          
          IF NEW.outlet_id IS NOT NULL THEN
            SELECT id INTO v_affiliated_vendor_wallet_id FROM wallets
            WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
              AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;
            
            IF v_affiliated_vendor_wallet_id IS NULL THEN
              INSERT INTO wallets (user_id, wallet_type, outlet_id) 
              VALUES ((SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id), 'vendor', NEW.outlet_id)
              RETURNING id INTO v_affiliated_vendor_wallet_id;
            END IF;
          ELSE
            SELECT id INTO v_affiliated_vendor_wallet_id FROM wallets
            WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
              AND wallet_type = 'vendor' AND outlet_id IS NULL;
              
            IF v_affiliated_vendor_wallet_id IS NULL THEN
              INSERT INTO wallets (user_id, wallet_type) 
              VALUES ((SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id), 'vendor')
              RETURNING id INTO v_affiliated_vendor_wallet_id;
            END IF;
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
            jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', GREATEST(v_platform_delivery_share, 0), 'vendor_share', v_rider_share));
          
          IF v_platform_delivery_share > 0 THEN
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
          END IF;
          
          UPDATE order_financials SET
            rider_commission_percentage = v_rider_commission_rate,
            rider_commission_amount = GREATEST(v_platform_delivery_share, 0)
          WHERE order_id = NEW.id;
        ELSE
          -- Platform/independent rider: use hybrid payout model
          SELECT rpd.final_rider_pay, rpd.platform_fee
          INTO v_payout_final_pay, v_payout_platform_fee
          FROM rider_payout_details rpd
          WHERE rpd.order_id = NEW.id
          LIMIT 1;
          
          IF v_payout_final_pay IS NOT NULL AND v_payout_final_pay > 0 THEN
            v_rider_share := v_payout_final_pay;
            v_platform_delivery_share := COALESCE(v_payout_platform_fee, v_delivery_fee - v_rider_share);
            v_rider_commission_rate := CASE WHEN v_delivery_fee > 0 
              THEN ROUND((v_platform_delivery_share / v_delivery_fee) * 100, 2)
              ELSE 0 END;
          ELSE
            v_rider_commission_rate := resolve_commission_rate('rider', v_rider_profile_id);
            v_platform_delivery_share := ROUND(v_delivery_fee * (v_rider_commission_rate / 100), 2);
            v_rider_share := v_delivery_fee - v_platform_delivery_share;
          END IF;
          
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
          
          UPDATE order_financials SET
            rider_commission_percentage = v_rider_commission_rate,
            rider_commission_amount = v_platform_delivery_share
          WHERE order_id = NEW.id;
        END IF;
      END IF;
    END IF;
    
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;
