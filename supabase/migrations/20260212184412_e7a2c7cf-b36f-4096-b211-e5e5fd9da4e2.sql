
-- Create a security definer function for admin wallet adjustments
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
  v_current_balance numeric;
  v_new_balance numeric;
  v_wallet_type text;
  v_tx_id uuid;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Validate adjust_type
  IF p_adjust_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid adjust_type: must be credit or debit';
  END IF;

  -- Get current balance
  IF p_environment = 'development' THEN
    SELECT test_balance, wallet_type INTO v_current_balance, v_wallet_type FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  ELSE
    SELECT balance, wallet_type INTO v_current_balance, v_wallet_type FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  END IF;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  -- Calculate new balance
  IF p_adjust_type = 'credit' THEN
    v_new_balance := v_current_balance + p_amount;
  ELSE
    IF p_amount > v_current_balance THEN
      RAISE EXCEPTION 'Insufficient balance for debit';
    END IF;
    v_new_balance := v_current_balance - p_amount;
  END IF;

  -- Update wallet balance (this bypasses the trigger since we're security definer)
  IF p_environment = 'development' THEN
    UPDATE wallets SET test_balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  ELSE
    UPDATE wallets SET balance = v_new_balance, updated_at = now() WHERE id = p_wallet_id;
  END IF;

  -- Insert transaction record
  INSERT INTO wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount, balance_after,
    status, environment, notes, metadata
  ) VALUES (
    p_wallet_id, v_wallet_type, p_adjust_type,
    CASE WHEN p_adjust_type = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, v_new_balance, 'completed', p_environment, p_notes,
    jsonb_build_object('adjusted_by_admin', true, 'payment_reference', COALESCE(p_reference, ''))
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id);
END;
$$;
