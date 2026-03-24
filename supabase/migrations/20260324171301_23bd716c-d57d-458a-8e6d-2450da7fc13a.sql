
CREATE OR REPLACE FUNCTION credit_vendor_on_payment()
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
  v_fee_pct NUMERIC;
  v_fee_min NUMERIC;
  v_fee_max NUMERIC;
  v_raw_platform_fee NUMERIC;
  v_gross_commission NUMERIC;
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
    
    -- Calculate gross commission on full menu price
    v_gross_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    
    -- Platform absorbs promo discount by reducing its commission
    -- If discount > commission, platform takes 0 commission (absorbs from service fee / own funds)
    v_platform_commission := GREATEST(0, v_gross_commission - v_promo_discount);
    
    -- Vendor gets more because commission is reduced by the discount amount
    v_vendor_share := v_menu_price - v_platform_commission + v_packaging_fee;
    
    -- Platform revenue = reduced commission + service fee (discount already absorbed in commission)
    v_company_revenue := v_platform_commission + v_service_fee;
    
    -- Track if platform is at a loss (when discount exceeds commission)
    IF v_promo_discount > v_gross_commission THEN
      -- Extra loss beyond commission
      v_company_revenue := v_company_revenue - (v_promo_discount - v_gross_commission);
    END IF;
    
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
    
    -- Platform gets the reduced commission (after discount absorption)
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
    
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'food_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Food commission from order #' || NEW.order_number || 
      CASE WHEN v_promo_discount > 0 THEN ' (reduced by ₦' || v_promo_discount || ' promo discount)' ELSE '' END
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
    
    -- If discount exceeds commission, platform absorbs the extra from its own balance
    IF v_promo_discount > v_gross_commission THEN
      IF v_is_test THEN
        UPDATE platform_wallet SET test_balance = COALESCE(test_balance, 0) - (v_promo_discount - v_gross_commission), updated_at = NOW()
        WHERE id = v_platform_wallet_id;
      ELSE
        UPDATE platform_wallet SET balance = COALESCE(balance, 0) - (v_promo_discount - v_gross_commission),
          total_earned = COALESCE(total_earned, 0) - (v_promo_discount - v_gross_commission), updated_at = NOW()
        WHERE id = v_platform_wallet_id;
      END IF;
      
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'debit', v_promo_discount - v_gross_commission, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Extra promo cost absorbed (discount exceeded commission) - order #' || NEW.order_number
      );
    END IF;
    
    -- Track promo stats
    IF v_promo_discount > 0 THEN
      INSERT INTO daily_promo_stats (stat_date, total_promo_cost, total_revenue, environment)
      VALUES (CURRENT_DATE, v_promo_discount, v_menu_price, NEW.environment)
      ON CONFLICT (stat_date, environment) 
      DO UPDATE SET 
        total_promo_cost = daily_promo_stats.total_promo_cost + v_promo_discount,
        total_revenue = daily_promo_stats.total_revenue + v_menu_price,
        updated_at = now();
    END IF;
    
    -- Credit vendor wallet with increased share
    IF v_is_test THEN
      UPDATE wallets SET 
        test_balance = COALESCE(test_balance, 0) + v_vendor_share,
        test_pending_balance = COALESCE(test_pending_balance, 0) + v_vendor_share,
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_vendor_share,
        updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
    ELSE
      UPDATE wallets SET 
        balance = COALESCE(balance, 0) + v_vendor_share,
        pending_balance = COALESCE(pending_balance, 0) + v_vendor_share,
        total_earned = COALESCE(total_earned, 0) + v_vendor_share,
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_vendor_share,
        updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
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
    IF v_delivery_fee > 0 AND NEW.rider_id IS NOT NULL THEN
      SELECT id INTO v_existing_rider_tx FROM wallet_transactions 
      WHERE order_id = NEW.id AND category IN ('rider_share', 'logistics_share', 'vendor_rider_share') LIMIT 1;
      
      IF v_existing_rider_tx IS NULL THEN
        SELECT id, delivery_company_id, affiliated_vendor_id 
        INTO v_rider_profile_id, v_delivery_company_id, v_affiliated_vendor_id
        FROM rider_profiles WHERE user_id = NEW.rider_id;

        -- Get clamped fee settings
        SELECT COALESCE(
          (SELECT value::numeric FROM platform_settings WHERE key = 'rider_platform_fee_pct'), 20
        ) INTO v_fee_pct;
        SELECT COALESCE(
          (SELECT value::numeric FROM platform_settings WHERE key = 'rider_platform_fee_min'), 300
        ) INTO v_fee_min;
        SELECT COALESCE(
          (SELECT value::numeric FROM platform_settings WHERE key = 'rider_platform_fee_max'), 700
        ) INTO v_fee_max;

        v_raw_platform_fee := ROUND(v_delivery_fee * (v_fee_pct / 100), 2);
        v_payout_platform_fee := GREATEST(v_fee_min, LEAST(v_raw_platform_fee, v_fee_max));
        v_payout_final_pay := v_delivery_fee - v_payout_platform_fee;
        
        IF v_payout_final_pay < 0 THEN
          v_payout_final_pay := 0;
          v_payout_platform_fee := v_delivery_fee;
        END IF;

        IF v_affiliated_vendor_id IS NOT NULL THEN
          -- Vendor-affiliated rider
          IF NEW.outlet_id IS NOT NULL THEN
            SELECT id INTO v_affiliated_vendor_wallet_id FROM wallets
            WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
            AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;
          ELSE
            SELECT id INTO v_affiliated_vendor_wallet_id FROM wallets
            WHERE user_id = (SELECT user_id FROM vendors WHERE id = v_affiliated_vendor_id)
            AND wallet_type = 'vendor' AND outlet_id IS NULL;
          END IF;

          IF v_affiliated_vendor_wallet_id IS NOT NULL THEN
            IF v_is_test THEN
              UPDATE wallets SET 
                test_balance = COALESCE(test_balance, 0) + v_payout_final_pay,
                test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_payout_final_pay,
                updated_at = NOW()
              WHERE id = v_affiliated_vendor_wallet_id;
            ELSE
              UPDATE wallets SET 
                balance = COALESCE(balance, 0) + v_payout_final_pay,
                rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_payout_final_pay,
                total_earned = COALESCE(total_earned, 0) + v_payout_final_pay,
                updated_at = NOW()
              WHERE id = v_affiliated_vendor_wallet_id;
            END IF;
            
            INSERT INTO wallet_transactions (
              wallet_type, category, transaction_type, amount, order_id,
              wallet_id, environment, status, notes, metadata
            ) VALUES (
              'vendor', 'vendor_rider_share', 'credit', v_payout_final_pay, NEW.id,
              v_affiliated_vendor_wallet_id, NEW.environment, 'completed',
              'Rider delivery share for order #' || NEW.order_number,
              jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_fee', v_payout_platform_fee, 'rider_user_id', NEW.rider_id)
            );

            v_rider_commission_rate := v_fee_pct;
          END IF;

        ELSIF v_delivery_company_id IS NOT NULL THEN
          -- Logistics company rider
          SELECT commission_rate INTO v_logistics_commission_rate 
          FROM delivery_companies WHERE id = v_delivery_company_id;
          v_logistics_commission_rate := COALESCE(v_logistics_commission_rate, 20);
          
          v_platform_delivery_share := ROUND(v_delivery_fee * (v_logistics_commission_rate / 100), 2);
          v_rider_share := v_delivery_fee - v_platform_delivery_share;
          
          SELECT user_id INTO v_company_user_id FROM delivery_companies WHERE id = v_delivery_company_id;
          SELECT id INTO v_company_wallet_id FROM wallets 
          WHERE user_id = v_company_user_id AND wallet_type = 'delivery_company';
          
          IF v_company_wallet_id IS NULL THEN
            INSERT INTO wallets (user_id, wallet_type) VALUES (v_company_user_id, 'delivery_company')
            RETURNING id INTO v_company_wallet_id;
          END IF;

          IF v_is_test THEN
            UPDATE wallets SET test_balance = COALESCE(test_balance, 0) + v_rider_share, updated_at = NOW()
            WHERE id = v_company_wallet_id;
          ELSE
            UPDATE wallets SET balance = COALESCE(balance, 0) + v_rider_share,
              total_earned = COALESCE(total_earned, 0) + v_rider_share, updated_at = NOW()
            WHERE id = v_company_wallet_id;
          END IF;

          INSERT INTO wallet_transactions (
            wallet_type, category, transaction_type, amount, order_id,
            wallet_id, environment, status, notes
          ) VALUES (
            'delivery_company', 'logistics_share', 'credit', v_rider_share, NEW.id,
            v_company_wallet_id, NEW.environment, 'completed',
            'Delivery share for order #' || NEW.order_number
          );
          
          v_rider_commission_rate := v_logistics_commission_rate;

        ELSE
          -- Freelance rider
          SELECT id INTO v_rider_wallet_id FROM wallets 
          WHERE user_id = NEW.rider_id AND wallet_type = 'rider';
          
          IF v_rider_wallet_id IS NULL THEN
            INSERT INTO wallets (user_id, wallet_type) VALUES (NEW.rider_id, 'rider')
            RETURNING id INTO v_rider_wallet_id;
          END IF;

          IF v_is_test THEN
            UPDATE wallets SET 
              test_balance = COALESCE(test_balance, 0) + v_payout_final_pay,
              test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_payout_final_pay,
              updated_at = NOW()
            WHERE id = v_rider_wallet_id;
          ELSE
            UPDATE wallets SET 
              balance = COALESCE(balance, 0) + v_payout_final_pay,
              eligible_balance = COALESCE(eligible_balance, 0) + v_payout_final_pay,
              total_earned = COALESCE(total_earned, 0) + v_payout_final_pay,
              updated_at = NOW()
            WHERE id = v_rider_wallet_id;
          END IF;
          
          INSERT INTO wallet_transactions (
            wallet_type, category, transaction_type, amount, order_id,
            wallet_id, environment, status, notes, metadata
          ) VALUES (
            'rider', 'rider_share', 'credit', v_payout_final_pay, NEW.id,
            v_rider_wallet_id, NEW.environment, 'completed',
            'Delivery earnings for order #' || NEW.order_number,
            jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_fee', v_payout_platform_fee)
          );
          
          v_rider_commission_rate := v_fee_pct;
        END IF;

        -- Platform gets delivery commission
        IF v_is_test THEN
          UPDATE platform_wallet SET test_balance = COALESCE(test_balance, 0) + v_payout_platform_fee, updated_at = NOW()
          WHERE id = v_platform_wallet_id;
        ELSE
          UPDATE platform_wallet SET 
            balance = COALESCE(balance, 0) + v_payout_platform_fee,
            total_earned = COALESCE(total_earned, 0) + v_payout_platform_fee,
            updated_at = NOW()
          WHERE id = v_platform_wallet_id;
        END IF;

        INSERT INTO wallet_transactions (
          wallet_type, category, transaction_type, amount, order_id,
          platform_wallet_id, environment, status, notes
        ) VALUES (
          'platform', 'delivery_commission', 'credit', v_payout_platform_fee, NEW.id,
          v_platform_wallet_id, NEW.environment, 'completed',
          'Delivery platform fee from order #' || NEW.order_number
        );

        -- Update order_financials with rider data
        UPDATE order_financials SET
          rider_commission_amount = v_payout_platform_fee,
          rider_commission_percentage = COALESCE(v_rider_commission_rate, v_fee_pct),
          logistics_commission_percentage = v_logistics_commission_rate
        WHERE order_id = NEW.id;
      END IF;
    END IF;
    
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$$;
