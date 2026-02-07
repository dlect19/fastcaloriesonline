
-- Create a function to reverse all financial splits when an order is cancelled
-- This reverses: vendor_share (pending), platform_commission, service_fee, 
-- rider_share/vendor_rider_share/delivery_company_share, delivery_commission, promo_cost
CREATE OR REPLACE FUNCTION public.reverse_financials_on_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_is_test BOOLEAN;
  v_order_number TEXT;
BEGIN
  -- Only trigger when status changes TO 'cancelled'
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.payment_status = 'paid' THEN
    
    v_is_test := (NEW.environment = 'development');
    v_order_number := NEW.order_number;
    
    -- Loop through ALL credit transactions for this order and reverse them
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
        -- Don't reverse already reversed transactions
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions rev 
          WHERE rev.order_id = NEW.id 
            AND rev.category = wt.category 
            AND rev.transaction_type = 'debit'
            AND rev.notes LIKE '%Reversal%'
        )
    LOOP
      -- Reverse wallet balances based on category
      CASE v_tx.category
        WHEN 'vendor_share' THEN
          -- Reverse vendor pending balance AND menu_earnings_pending
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
          
          -- If the vendor_share was already released (status = 'completed'), 
          -- also reverse the eligible/available balance and menu_earnings_balance
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
          -- Reverse platform wallet
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
          -- Reverse rider wallet
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
          -- Reverse vendor's rider delivery revenue
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
          -- Reverse delivery company wallet
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
          -- Skip unknown categories
          NULL;
      END CASE;
      
      -- Insert reversal debit transaction for audit trail
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, platform_wallet_id, environment, status, notes
      ) VALUES (
        v_tx.wallet_type, v_tx.category, 'debit', v_tx.amount, NEW.id,
        v_tx.wallet_id, v_tx.platform_wallet_id, v_tx.environment, 'completed',
        'Reversal - Order #' || v_order_number || ' cancelled'
      );
      
      -- Mark original pending transaction as cancelled if still pending
      IF v_tx.tx_status = 'pending' THEN
        UPDATE wallet_transactions 
        SET status = 'cancelled', notes = COALESCE(notes, '') || ' [Cancelled]'
        WHERE id = v_tx.id;
      END IF;
      
    END LOOP;
    
    -- Also reverse promo_cost debit (give back the promo cost to platform since order was cancelled)
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
      -- Credit back the promo cost to platform
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
      
      -- Insert reversal credit for promo_cost
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'credit', v_tx.amount, NEW.id,
        v_tx.platform_wallet_id, v_tx.environment, 'completed',
        'Reversal - Promo cost returned, Order #' || v_order_number || ' cancelled'
      );
    END LOOP;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for order cancellation financial reversal
DROP TRIGGER IF EXISTS trigger_reverse_financials_on_cancellation ON orders;
CREATE TRIGGER trigger_reverse_financials_on_cancellation
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
  EXECUTE FUNCTION public.reverse_financials_on_cancellation();
