
-- Update the trigger to check for a bypass flag
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow bypass when called from admin RPC via session flag
  IF current_setting('app.bypass_balance_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Allow service_role to make changes
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Revert balance fields to old values for non-service-role callers
  NEW.balance := OLD.balance;
  NEW.test_balance := OLD.test_balance;
  NEW.pending_balance := OLD.pending_balance;
  NEW.test_pending_balance := OLD.test_pending_balance;
  NEW.eligible_balance := OLD.eligible_balance;
  NEW.test_eligible_balance := OLD.test_eligible_balance;
  NEW.total_earned := OLD.total_earned;
  NEW.total_withdrawn := OLD.total_withdrawn;
  NEW.pending_payouts := OLD.pending_payouts;
  NEW.menu_earnings_balance := OLD.menu_earnings_balance;
  NEW.test_menu_earnings_balance := OLD.test_menu_earnings_balance;
  NEW.menu_earnings_pending := OLD.menu_earnings_pending;
  NEW.test_menu_earnings_pending := OLD.test_menu_earnings_pending;
  NEW.rider_revenue_balance := OLD.rider_revenue_balance;
  NEW.test_rider_revenue_balance := OLD.test_rider_revenue_balance;

  RETURN NEW;
END;
$$;

-- Update admin_adjust to use the bypass flag instead of role switching
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet_balance(
  p_wallet_id uuid,
  p_amount numeric,
  p_adjust_type text,
  p_notes text,
  p_environment text DEFAULT 'production',
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_current_balance numeric;
  v_new_balance numeric;
  v_wallet_type text;
  v_tx_id uuid;
BEGIN
  v_caller_id := auth.uid();

  IF NOT has_role(v_caller_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  IF p_adjust_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid adjust_type: must be credit or debit';
  END IF;

  -- Set bypass flag instead of changing role
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF p_environment = 'development' THEN
    SELECT test_balance, wallet_type INTO v_current_balance, v_wallet_type FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  ELSE
    SELECT balance, wallet_type INTO v_current_balance, v_wallet_type FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  END IF;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  IF p_adjust_type = 'credit' THEN
    v_new_balance := v_current_balance + p_amount;
  ELSE
    IF p_amount > v_current_balance THEN
      RAISE EXCEPTION 'Insufficient balance for debit';
    END IF;
    v_new_balance := v_current_balance - p_amount;
  END IF;

  IF p_environment = 'development' THEN
    UPDATE wallets SET test_balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  ELSE
    UPDATE wallets SET balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  END IF;

  INSERT INTO wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount, balance_after,
    status, environment, notes, metadata
  ) VALUES (
    p_wallet_id, v_wallet_type, p_adjust_type,
    CASE WHEN p_adjust_type = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, v_new_balance, 'completed', p_environment, p_notes,
    jsonb_build_object('adjusted_by_admin', true, 'adjusted_by', v_caller_id, 'payment_reference', COALESCE(p_reference, ''))
  )
  RETURNING id INTO v_tx_id;

  -- Reset bypass flag
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id);
END;
$$;
