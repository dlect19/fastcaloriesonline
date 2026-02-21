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
        -- Skip cancelled credits (they were never counted in balance)
        AND wt.status != 'cancelled'
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
          IF v_tx.tx_status = 'pending' THEN
            -- For pending credits, just mark them as cancelled and deduct from pending
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
            
            -- Mark the pending credit as cancelled (no reversal debit needed)
            UPDATE wallet_transactions 
            SET status = 'cancelled', notes = COALESCE(notes, '') || ' [Cancelled]'
            WHERE id = v_tx.id;
            
            -- Skip creating a reversal debit for pending credits
            CONTINUE;
          END IF;
          
          -- For completed credits, do the full reversal
          IF v_is_test THEN
            UPDATE wallets SET 
              test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - v_tx.amount, 0),
              test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - v_tx.amount, 0),
              test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - v_tx.amount, 0),
              test_balance = GREATEST(COALESCE(test_balance, 0) - v_tx.amount, 0),
              test_menu_earnings_balance = GREATEST(COALESCE(test_menu_earnings_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
          ELSE
            UPDATE wallets SET 
              pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_tx.amount, 0),
              menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - v_tx.amount, 0),
              eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - v_tx.amount, 0),
              balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0),
              menu_earnings_balance = GREATEST(COALESCE(menu_earnings_balance, 0) - v_tx.amount, 0),
              updated_at = NOW()
            WHERE id = v_tx.wallet_id;
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
      
      -- Only create reversal debit for completed credits
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, platform_wallet_id, environment, status, notes
      ) VALUES (
        v_tx.wallet_type, v_tx.category, 'debit', v_tx.amount, NEW.id,
        v_tx.wallet_id, v_tx.platform_wallet_id, v_tx.environment, 'completed',
        'Reversal - Order #' || v_order_number || ' cancelled'
      );
      
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