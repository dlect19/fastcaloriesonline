
-- Fix: Add bypass flag to functions that legitimately update wallet balances
-- but don't run as service_role (cron jobs run as postgres, client triggers run as authenticated)

-- 1. Fix release_pending_vendor_earnings (runs via pg_cron as postgres)
CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  released_count INTEGER := 0;
  default_hold_hours INTEGER := 24;
  restaurant_hold INTEGER := 0;
  pharmacy_hold INTEGER := 12;
  market_hold INTEGER := 24;
  tx RECORD;
  v_wallet_id UUID;
  v_is_test BOOLEAN;
  v_amount NUMERIC;
  v_vendor_category TEXT;
  v_hold_hours INTEGER;
BEGIN
  -- Bypass the prevent_direct_balance_update trigger
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  SELECT COALESCE(value::integer, 24) INTO default_hold_hours 
  FROM platform_settings WHERE key = 'vendor_hold_period_hours' LIMIT 1;
  
  SELECT COALESCE(value::integer, 0) INTO restaurant_hold 
  FROM platform_settings WHERE key = 'settlement_hours_restaurant' LIMIT 1;
  
  SELECT COALESCE(value::integer, 12) INTO pharmacy_hold 
  FROM platform_settings WHERE key = 'settlement_hours_pharmacy' LIMIT 1;
  
  SELECT COALESCE(value::integer, 24) INTO market_hold 
  FROM platform_settings WHERE key = 'settlement_hours_market' LIMIT 1;
  
  FOR tx IN 
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment, wt.created_at,
           v.category AS vendor_category
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    JOIN vendors v ON v.user_id = w.user_id
    WHERE wt.category = 'vendor_share'
      AND wt.status = 'pending'
      AND wt.wallet_id IS NOT NULL
  LOOP
    v_wallet_id := tx.wallet_id;
    v_amount := tx.amount;
    v_is_test := (tx.environment = 'development');
    v_vendor_category := COALESCE(tx.vendor_category, 'restaurant');
    
    v_hold_hours := CASE v_vendor_category
      WHEN 'restaurant' THEN restaurant_hold
      WHEN 'pharmacy' THEN pharmacy_hold
      WHEN 'market' THEN market_hold
      ELSE default_hold_hours
    END;
    
    IF tx.created_at >= NOW() - (v_hold_hours || ' hours')::interval THEN
      CONTINUE;
    END IF;
    
    IF v_is_test THEN
      UPDATE wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - v_amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
        test_balance = COALESCE(test_balance, 0) + v_amount,
        test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - v_amount, 0),
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_amount,
        updated_at = NOW()
      WHERE id = v_wallet_id;
    ELSE
      UPDATE wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
        balance = COALESCE(balance, 0) + v_amount,
        menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - v_amount, 0),
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_amount,
        updated_at = NOW()
      WHERE id = v_wallet_id;
    END IF;
    
    UPDATE wallet_transactions
    SET status = 'completed',
        notes = 'Released after ' || v_hold_hours || 'hr hold (' || v_vendor_category || ')'
    WHERE id = tx.id;
    
    released_count := released_count + 1;
  END LOOP;
  
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN released_count;
END;
$function$;

-- 2. Fix deduct_wallet_on_payout_request (runs as authenticated user)
CREATE OR REPLACE FUNCTION public.deduct_wallet_on_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
  v_available NUMERIC;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Bypass the prevent_direct_balance_update trigger
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  v_amount := NEW.amount;
  v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');

  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  SELECT * INTO v_wallet FROM wallets WHERE id = NEW.wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      v_available := CASE WHEN v_is_test 
        THEN COALESCE(v_wallet.test_rider_revenue_balance, 0)
        ELSE COALESCE(v_wallet.rider_revenue_balance, 0) END;
    ELSE
      v_available := CASE WHEN v_is_test
        THEN COALESCE(v_wallet.test_menu_earnings_balance, 0)
        ELSE COALESCE(v_wallet.menu_earnings_balance, 0) END;
    END IF;
  ELSE
    v_available := CASE WHEN v_is_test
      THEN COALESCE(v_wallet.test_eligible_balance, 0)
      ELSE COALESCE(v_wallet.eligible_balance, 0) END;
  END IF;

  IF v_amount > v_available THEN
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      IF v_is_test THEN
        UPDATE wallets SET
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          rider_revenue_balance = COALESCE(rider_revenue_balance, 0) - v_amount,
          eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
          balance = COALESCE(balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) - v_amount,
          test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
          test_balance = COALESCE(test_balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance, 0) - v_amount,
          eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
          balance = COALESCE(balance, 0) - v_amount,
          pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
  ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
    IF v_is_test THEN
      UPDATE wallets SET
        test_eligible_balance = COALESCE(test_eligible_balance, 0) - v_amount,
        test_balance = COALESCE(test_balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE wallets SET
        eligible_balance = COALESCE(eligible_balance, 0) - v_amount,
        balance = COALESCE(balance, 0) - v_amount,
        pending_payouts = COALESCE(pending_payouts, 0) + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  INSERT INTO wallet_transactions (
    wallet_type, category, transaction_type, amount, 
    wallet_id, environment, status, notes
  ) VALUES (
    NEW.user_type, 'withdrawal', 'debit', v_amount,
    NEW.wallet_id, 
    CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
    'completed',
    'Withdrawal request of ₦' || v_amount || ' - ' || 
    CASE v_source WHEN 'rider_revenue' THEN 'Rider Revenue' ELSE 'Menu Earnings' END
  );

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$$;

-- 3. Fix restore_wallet_on_payout_failure (may run from various contexts)
CREATE OR REPLACE FUNCTION public.restore_wallet_on_payout_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
BEGIN
  -- Bypass the prevent_direct_balance_update trigger
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF (NEW.status IN ('failed', 'rejected', 'cancelled')) 
     AND (OLD.status NOT IN ('failed', 'rejected', 'cancelled')) THEN
    
    v_amount := NEW.amount;
    v_source := COALESCE(NEW.withdrawal_source, 'menu_earnings');
    v_is_test := (get_platform_environment() = 'development');

    IF NEW.user_type = 'vendor' THEN
      IF v_source = 'rider_revenue' THEN
        IF v_is_test THEN
          UPDATE wallets SET
            test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + v_amount,
            test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
            test_balance = COALESCE(test_balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        ELSE
          UPDATE wallets SET
            rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + v_amount,
            eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
            balance = COALESCE(balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        END IF;
      ELSE
        IF v_is_test THEN
          UPDATE wallets SET
            test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + v_amount,
            test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
            test_balance = COALESCE(test_balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        ELSE
          UPDATE wallets SET
            menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + v_amount,
            eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
            balance = COALESCE(balance, 0) + v_amount,
            pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
            updated_at = NOW()
          WHERE id = NEW.wallet_id;
        END IF;
      END IF;
    ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
      IF v_is_test THEN
        UPDATE wallets SET
          test_eligible_balance = COALESCE(test_eligible_balance, 0) + v_amount,
          test_balance = COALESCE(test_balance, 0) + v_amount,
          pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE wallets SET
          eligible_balance = COALESCE(eligible_balance, 0) + v_amount,
          balance = COALESCE(balance, 0) + v_amount,
          pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;

    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount,
      wallet_id, environment, status, notes
    ) VALUES (
      NEW.user_type, 'withdrawal_reversal', 'credit', v_amount,
      NEW.wallet_id,
      CASE WHEN v_is_test THEN 'development' ELSE 'production' END,
      'completed',
      'Withdrawal ' || NEW.status || ' - ₦' || v_amount || ' restored to ' ||
      CASE v_source WHEN 'rider_revenue' THEN 'Rider Revenue' ELSE 'Menu Earnings' END
    );
  END IF;

  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    v_amount := NEW.amount;
    UPDATE wallets SET
      pending_payouts = GREATEST(COALESCE(pending_payouts, 0) - v_amount, 0),
      total_withdrawn = COALESCE(total_withdrawn, 0) + v_amount,
      updated_at = NOW()
    WHERE id = NEW.wallet_id;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$function$;

-- 4. Fix reverse_financials_on_cancellation (fires from client updates)
CREATE OR REPLACE FUNCTION public.reverse_financials_on_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx RECORD;
  v_is_test BOOLEAN;
  v_order_number TEXT;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.payment_status = 'paid' THEN
    
    -- Bypass the prevent_direct_balance_update trigger
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    
    v_is_test := (NEW.environment = 'development');
    v_order_number := NEW.order_number;
    
    FOR v_tx IN
      SELECT wt.id, wt.wallet_id, wt.platform_wallet_id, wt.wallet_type, 
             wt.category, wt.amount, wt.environment, wt.status as tx_status
      FROM wallet_transactions wt
      WHERE wt.order_id = NEW.id
        AND wt.transaction_type = 'credit'
        AND wt.category IN (
          'vendor_share', 'platform_commission', 'service_fee', 
          'rider_share', 'vendor_rider_share', 'delivery_company_share', 
          'delivery_commission'
        )
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions rev 
          WHERE rev.order_id = NEW.id 
            AND rev.category = wt.category 
            AND rev.transaction_type = 'debit'
            AND rev.notes LIKE '%Reversal%'
        )
    LOOP
      CASE v_tx.category
        WHEN 'vendor_share' THEN
          IF v_is_test THEN
            UPDATE wallets SET 
              test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - v_tx.amount, 0),
              test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          ELSE
            UPDATE wallets SET 
              pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_tx.amount, 0),
              menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          END IF;
          
          IF v_tx.tx_status = 'completed' THEN
            IF v_is_test THEN
              UPDATE wallets SET 
                test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_tx.amount, 0),
                test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
                test_menu_earnings_balance = GREATEST(COALESCE(test_menu_earnings_balance, 0) - v_tx.amount, 0),
                updated_at = NOW()
              WHERE id = v_tx.wallet_id;
            ELSE
              UPDATE wallets SET 
                eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_tx.amount, 0),
                balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
                menu_earnings_balance = GREATEST(COALESCE(menu_earnings_balance, 0) - v_tx.amount, 0),
                updated_at = NOW()
              WHERE id = v_tx.wallet_id;
            END IF;
          END IF;
        
        WHEN 'platform_commission', 'service_fee', 'delivery_commission' THEN
          IF v_is_test THEN
            UPDATE platform_wallet SET 
              test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.platform_wallet_id;
          ELSE
            UPDATE platform_wallet SET 
              balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
              total_earned = GREATEST(COALESCE(total_earned, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.platform_wallet_id;
          END IF;
        
        WHEN 'rider_share' THEN
          IF v_is_test THEN
            UPDATE wallets SET 
              test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
              test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          ELSE
            UPDATE wallets SET 
              balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
              eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_tx.amount, 0),
              total_earned = GREATEST(COALESCE(total_earned, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          END IF;
        
        WHEN 'vendor_rider_share' THEN
          IF v_is_test THEN
            UPDATE wallets SET 
              test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
              test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_tx.amount, 0),
              test_rider_revenue_balance = GREATEST(COALESCE(test_rider_revenue_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          ELSE
            UPDATE wallets SET 
              balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
              eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_tx.amount, 0),
              total_earned = GREATEST(COALESCE(total_earned, 0) - v_tx.amount, 0),
              rider_revenue_balance = GREATEST(COALESCE(rider_revenue_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          END IF;
        
        WHEN 'delivery_company_share' THEN
          IF v_is_test THEN
            UPDATE wallets SET 
              test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
              test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          ELSE
            UPDATE wallets SET 
              balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
              eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_tx.amount, 0),
              total_earned = GREATEST(COALESCE(total_earned, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          END IF;
        
        ELSE
          NULL;
      END CASE;
      
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, platform_wallet_id, environment, status, notes
      ) VALUES (
        v_tx.wallet_type, v_tx.category, 'debit', v_tx.amount, NEW.id,
        v_tx.wallet_id, v_tx.platform_wallet_id, v_tx.environment, 'completed',
        'Reversal - Order #' || v_order_number || ' cancelled'
      );
      
      IF v_tx.tx_status = 'pending' THEN
        UPDATE wallet_transactions 
        SET status = 'cancelled', notes = COALESCE(notes, '') || ' [Cancelled]'
        WHERE id = v_tx.id;
      END IF;
      
    END LOOP;
    
    FOR v_tx IN
      SELECT wt.id, wt.platform_wallet_id, wt.amount, wt.environment
      FROM wallet_transactions wt
      WHERE wt.order_id = NEW.id
        AND wt.category = 'promo_cost'
        AND wt.transaction_type = 'debit'
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions rev 
          WHERE rev.order_id = NEW.id 
            AND rev.category = 'promo_cost' 
            AND rev.transaction_type = 'credit'
            AND rev.notes LIKE '%Reversal%'
        )
    LOOP
      IF v_is_test THEN
        UPDATE platform_wallet SET 
          test_balance = COALESCE(test_balance, 0) + v_tx.amount,
          updated_at = NOW()
        WHERE id = v_tx.platform_wallet_id;
      ELSE
        UPDATE platform_wallet SET 
          balance = COALESCE(balance, 0) + v_tx.amount,
          updated_at = NOW()
        WHERE id = v_tx.platform_wallet_id;
      END IF;
      
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'credit', v_tx.amount, NEW.id,
        v_tx.platform_wallet_id, v_tx.environment, 'completed',
        'Reversal - Promo cost returned, Order #' || v_order_number || ' cancelled'
      );
    END LOOP;
    
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 5. Now fix TOP KITCHEN's wallet - the release ran but balance wasn't updated
-- The transaction shows 1645 was released (status=completed), but wallet columns are still 0
UPDATE wallets SET
  balance = 1645.00,
  eligible_balance = 1645.00,
  menu_earnings_balance = 1645.00,
  menu_earnings_pending = 0,
  pending_balance = 0
WHERE id = '1bb29c33-a559-44de-98b7-7b3eec2ff80f';
