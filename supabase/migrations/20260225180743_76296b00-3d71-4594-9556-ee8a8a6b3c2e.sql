
-- Update admin_adjust_wallet_balance to allow negative balances for vendor/rider/delivery_company wallets
-- Cap at -5000, auto-suspend when below -5000
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

  IF p_adjust_type = 'credit' THEN
    v_new_balance := v_current_balance + p_amount;
  ELSE
    -- For customer wallets, don't allow going below zero
    IF v_wallet_type = 'customer' THEN
      IF p_amount > v_current_balance THEN
        RAISE EXCEPTION 'Insufficient balance for debit';
      END IF;
    END IF;
    -- For vendor/rider/delivery_company, allow negative down to -5000
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
    status, environment, notes, metadata
  ) VALUES (
    p_wallet_id, v_wallet_type, p_adjust_type,
    CASE WHEN p_adjust_type = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, v_new_balance, 'completed', p_environment, p_notes,
    jsonb_build_object('adjusted_by_admin', true, 'adjusted_by', v_caller_id, 'payment_reference', COALESCE(p_reference, ''), 'chargeback', true)
  )
  RETURNING id INTO v_tx_id;

  -- Auto-suspend vendor/rider/delivery_company if balance drops to -5000
  IF v_new_balance <= -5000 AND v_wallet_type IN ('vendor', 'rider', 'delivery_company') THEN
    -- Suspend the entity
    IF v_wallet_type = 'vendor' THEN
      UPDATE vendors SET is_active = false WHERE user_id = v_user_id;
      -- Log suspension
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
  END IF;

  -- Reset bypass flag
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  RETURN jsonb_build_object(
    'success', true, 
    'new_balance', v_new_balance, 
    'transaction_id', v_tx_id,
    'suspended', v_new_balance <= -5000 AND v_wallet_type IN ('vendor', 'rider', 'delivery_company')
  );
END;
$function$;
