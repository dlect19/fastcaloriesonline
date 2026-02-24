
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
      
      -- Update order_financials with logistics commission
      UPDATE order_financials SET
        logistics_commission_percentage = v_commission_rate,
        logistics_commission_amount = v_platform_delivery_share
      WHERE order_id = NEW.id;

    ELSIF v_affiliated_vendor_id IS NOT NULL THEN
      -- Vendor-affiliated rider: use resolve_commission_rate
      v_commission_rate := resolve_commission_rate('rider', v_rider_profile_id);
      v_platform_delivery_share := ROUND(v_delivery_fee * (v_commission_rate / 100), 2);
      v_rider_share := v_delivery_fee - v_platform_delivery_share;
      
      -- Route to outlet-specific wallet
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
      
      IF v_vendor_wallet_id IS NOT NULL THEN
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
          jsonb_build_object('delivery_fee', v_delivery_fee, 'platform_share', v_platform_delivery_share, 'vendor_share', v_rider_share));
      END IF;
      
      -- Update order_financials with rider commission
      UPDATE order_financials SET
        rider_commission_percentage = v_commission_rate,
        rider_commission_amount = v_platform_delivery_share
      WHERE order_id = NEW.id;
      
    ELSE
      -- Platform/independent rider
      -- Check rider_payout_details for the accurate payout calculation
      SELECT rpd.final_rider_pay, rpd.platform_fee
      INTO v_payout_final_pay, v_payout_platform_fee
      FROM rider_payout_details rpd
      WHERE rpd.order_id = NEW.id
      LIMIT 1;
      
      IF v_payout_final_pay IS NOT NULL AND v_payout_final_pay > 0 THEN
        v_rider_share := v_payout_final_pay;
        v_platform_delivery_share := COALESCE(v_payout_platform_fee, v_delivery_fee - v_rider_share);
        v_commission_rate := ROUND((v_platform_delivery_share / v_delivery_fee) * 100, 2);
      ELSE
        -- Fallback to dynamic commission rate
        v_commission_rate := resolve_commission_rate('rider', v_rider_profile_id);
        v_platform_delivery_share := ROUND(v_delivery_fee * (v_commission_rate / 100), 2);
        v_rider_share := v_delivery_fee - v_platform_delivery_share;
      END IF;
      
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
      
      -- Update order_financials with rider commission
      UPDATE order_financials SET
        rider_commission_percentage = v_commission_rate,
        rider_commission_amount = v_platform_delivery_share
      WHERE order_id = NEW.id;
    END IF;
    
    -- Platform always gets its delivery commission share
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
    
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;
