
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet_balance(p_wallet_id uuid, p_amount numeric, p_adjust_type text, p_notes text, p_environment text DEFAULT 'production'::text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_current_balance numeric;
  v_new_balance numeric;
  v_wallet_type text;
  v_tx_id uuid;
  v_user_id uuid;
  v_outlet_id uuid;
  v_order_id uuid;
BEGIN
  v_caller_id := auth.uid();

  IF NOT has_role(v_caller_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  IF p_adjust_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid adjust_type: must be credit or debit';
  END IF;

  -- Set bypass flag
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF p_environment = 'development' THEN
    SELECT test_balance, wallet_type, user_id, outlet_id INTO v_current_balance, v_wallet_type, v_user_id, v_outlet_id FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  ELSE
    SELECT balance, wallet_type, user_id, outlet_id INTO v_current_balance, v_wallet_type, v_user_id, v_outlet_id FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  END IF;

  IF v_wallet_type IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  -- If this is a chargeback (notes start with [CHARGEBACK]), enforce duplicate prevention
  IF p_adjust_type = 'debit' AND p_notes LIKE '[CHARGEBACK]%' AND p_reference IS NOT NULL AND p_reference LIKE 'Order #%' THEN
    -- Try to resolve order_id from the reference
    SELECT id INTO v_order_id FROM orders WHERE order_number = regexp_replace(p_reference, '^Order #', '') LIMIT 1;
    
    IF v_order_id IS NOT NULL THEN
      -- Use advisory lock to serialize chargebacks for same order+wallet
      PERFORM pg_advisory_xact_lock(hashtext(p_wallet_id::text || '_' || v_order_id::text));
      
      -- Check for existing chargeback
      IF EXISTS (
        SELECT 1 FROM wallet_transactions 
        WHERE wallet_id = p_wallet_id 
          AND transaction_type = 'debit' 
          AND category = 'admin_debit'
          AND status = 'completed'
          AND (
            order_id = v_order_id
            OR notes ILIKE '%' || p_reference || '%'
            OR metadata->>'payment_reference' = p_reference
          )
      ) THEN
        PERFORM set_config('app.bypass_balance_trigger', 'false', true);
        RAISE EXCEPTION 'Duplicate chargeback: A chargeback for % has already been applied to this wallet', p_reference;
      END IF;
    END IF;
  END IF;

  IF p_adjust_type = 'credit' THEN
    v_new_balance := v_current_balance + p_amount;
  ELSE
    IF v_wallet_type = 'customer' THEN
      IF p_amount > v_current_balance THEN
        RAISE EXCEPTION 'Insufficient balance for debit';
      END IF;
    END IF;
    IF v_wallet_type IN ('vendor', 'rider', 'delivery_company') THEN
      IF (v_current_balance - p_amount) < -5000 THEN
        RAISE EXCEPTION 'Cannot debit below -₦5,000. Current: ₦%, Requested: ₦%', v_current_balance, p_amount;
      END IF;
    END IF;
    v_new_balance := v_current_balance - p_amount;
  END IF;

  IF p_environment = 'development' THEN
    UPDATE wallets SET test_balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  ELSE
    UPDATE wallets SET balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  END IF;

  -- Also update eligible_balance for vendor/rider/delivery_company
  IF p_adjust_type = 'debit' AND v_wallet_type IN ('vendor', 'rider', 'delivery_company') THEN
    IF p_environment = 'development' THEN
      UPDATE wallets SET 
        test_eligible_balance = GREATEST(COALESCE(test_eligible_balance, 0) - p_amount, -5000),
        test_menu_earnings_balance = CASE WHEN v_wallet_type = 'vendor' 
          THEN GREATEST(COALESCE(test_menu_earnings_balance, 0) - p_amount, -5000) 
          ELSE test_menu_earnings_balance END
      WHERE id = p_wallet_id;
    ELSE
      UPDATE wallets SET 
        eligible_balance = GREATEST(COALESCE(eligible_balance, 0) - p_amount, -5000),
        menu_earnings_balance = CASE WHEN v_wallet_type = 'vendor' 
          THEN GREATEST(COALESCE(menu_earnings_balance, 0) - p_amount, -5000) 
          ELSE menu_earnings_balance END
      WHERE id = p_wallet_id;
    END IF;
  END IF;

  INSERT INTO wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount, balance_after,
    status, environment, notes, order_id, metadata
  ) VALUES (
    p_wallet_id, v_wallet_type, p_adjust_type,
    CASE WHEN p_adjust_type = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, v_new_balance, 'completed', p_environment, p_notes,
    v_order_id,
    jsonb_build_object('adjusted_by_admin', true, 'adjusted_by', v_caller_id, 'payment_reference', COALESCE(p_reference, ''), 'chargeback', true)
  )
  RETURNING id INTO v_tx_id;

  -- Auto-suspend vendor/rider/delivery_company if balance drops to -5000
  IF v_new_balance <= -5000 AND v_wallet_type IN ('vendor', 'rider', 'delivery_company') THEN
    IF v_wallet_type = 'vendor' THEN
      UPDATE vendors SET is_active = false WHERE user_id = v_user_id;
      INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
      VALUES (v_caller_id, 'auto_suspended', 'vendor', v_user_id::text, 
        jsonb_build_object('reason', 'Wallet balance exceeded -₦5,000 chargeback limit', 'balance', v_new_balance));
    ELSIF v_wallet_type = 'rider' THEN
      UPDATE rider_profiles SET is_active = false WHERE user_id = v_user_id;
      INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
      VALUES (v_caller_id, 'auto_suspended', 'rider', v_user_id::text,
        jsonb_build_object('reason', 'Wallet balance exceeded -₦5,000 chargeback limit', 'balance', v_new_balance));
    ELSIF v_wallet_type = 'delivery_company' THEN
      UPDATE delivery_companies SET is_active = false WHERE user_id = v_user_id;
      INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
      VALUES (v_caller_id, 'auto_suspended', 'delivery_company', v_user_id::text,
        jsonb_build_object('reason', 'Wallet balance exceeded -₦5,000 chargeback limit', 'balance', v_new_balance));
    END IF;

    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id, 'suspended', true);
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id, 'suspended', false);
END;
$function$;
