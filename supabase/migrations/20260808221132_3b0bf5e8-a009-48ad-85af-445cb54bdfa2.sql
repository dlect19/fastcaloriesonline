CREATE OR REPLACE FUNCTION public.post_wallet_entry(
  p_wallet_id uuid,
  p_wallet_type text,
  p_transaction_type text,
  p_category text,
  p_amount numeric,
  p_reference text,
  p_environment text DEFAULT 'production',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_target text DEFAULT 'balance',
  p_status text DEFAULT 'completed',
  p_paystack_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_delta numeric;
  v_is_test boolean := (p_environment = 'development');
  v_tx_id uuid;
  v_balance_after numeric;
BEGIN
  IF p_wallet_id IS NULL THEN
    RAISE EXCEPTION 'post_wallet_entry: p_wallet_id is required';
  END IF;
  IF p_reference IS NULL OR length(trim(p_reference)) = 0 THEN
    RAISE EXCEPTION 'post_wallet_entry: p_reference is required for idempotency';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'post_wallet_entry: p_amount must be positive';
  END IF;
  IF p_transaction_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'post_wallet_entry: p_transaction_type must be credit or debit';
  END IF;
  IF p_target NOT IN ('balance', 'eligible', 'pending') THEN
    RAISE EXCEPTION 'post_wallet_entry: p_target must be balance, eligible or pending';
  END IF;

  PERFORM 1 FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

  SELECT id INTO v_existing
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND reference = p_reference
  LIMIT 1;

  IF v_existing IS NULL AND p_paystack_reference IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.wallet_transactions
    WHERE paystack_reference = p_paystack_reference
      AND category = p_category
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_delta := CASE WHEN p_transaction_type = 'credit' THEN p_amount ELSE -p_amount END;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF p_status = 'completed' THEN
    IF p_target = 'balance' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET test_balance = COALESCE(test_balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING test_balance INTO v_balance_after;
      ELSE
        UPDATE public.wallets SET balance = COALESCE(balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING balance INTO v_balance_after;
      END IF;
    ELSIF p_target = 'eligible' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET test_eligible_balance = COALESCE(test_eligible_balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING test_eligible_balance INTO v_balance_after;
      ELSE
        UPDATE public.wallets SET eligible_balance = COALESCE(eligible_balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING eligible_balance INTO v_balance_after;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET test_pending_balance = COALESCE(test_pending_balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING test_pending_balance INTO v_balance_after;
      ELSE
        UPDATE public.wallets SET pending_balance = COALESCE(pending_balance,0) + v_delta, updated_at = now()
        WHERE id = p_wallet_id RETURNING pending_balance INTO v_balance_after;
      END IF;
    END IF;
  ELSE
    IF v_is_test THEN
      SELECT test_balance INTO v_balance_after FROM public.wallets WHERE id = p_wallet_id;
    ELSE
      SELECT balance INTO v_balance_after FROM public.wallets WHERE id = p_wallet_id;
    END IF;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount,
    balance_after, reference, order_id, status, environment, notes, metadata, paystack_reference
  ) VALUES (
    p_wallet_id, p_wallet_type, p_transaction_type, p_category, p_amount,
    v_balance_after, p_reference, p_order_id, p_status, p_environment, p_notes,
    COALESCE(p_metadata, '{}'::jsonb), p_paystack_reference
  )
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_wallet_entry(uuid, text, text, text, numeric, text, text, uuid, text, jsonb, text, text, text) TO service_role;