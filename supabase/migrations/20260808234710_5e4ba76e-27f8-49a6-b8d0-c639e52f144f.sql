ALTER TABLE public.wallet_balance_guard_log ALTER COLUMN wallet_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.log_unguarded_platform_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass boolean := COALESCE(current_setting('app.bypass_balance_trigger', true), 'off') IN ('on','true');
BEGIN
  IF v_bypass THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.balance,0) <> COALESCE(OLD.balance,0) THEN
    INSERT INTO public.wallet_balance_guard_log (
      wallet_id, column_name, old_value, new_value, delta, session_user_name, current_role_name
    ) VALUES (
      NULL, 'platform.balance', OLD.balance, NEW.balance,
      COALESCE(NEW.balance,0) - COALESCE(OLD.balance,0),
      session_user::text, current_setting('role', true)
    );
  END IF;

  IF COALESCE(NEW.test_balance,0) <> COALESCE(OLD.test_balance,0) THEN
    INSERT INTO public.wallet_balance_guard_log (
      wallet_id, column_name, old_value, new_value, delta, session_user_name, current_role_name
    ) VALUES (
      NULL, 'platform.test_balance', OLD.test_balance, NEW.test_balance,
      COALESCE(NEW.test_balance,0) - COALESCE(OLD.test_balance,0),
      session_user::text, current_setting('role', true)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_unguarded_platform_balance ON public.platform_wallet;
CREATE TRIGGER trg_log_unguarded_platform_balance
AFTER UPDATE ON public.platform_wallet
FOR EACH ROW
EXECUTE FUNCTION public.log_unguarded_platform_balance_change();

CREATE OR REPLACE FUNCTION public.post_platform_entry(
  p_amount numeric,
  p_category text,
  p_transaction_type text,
  p_reference text,
  p_environment text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_delta numeric;
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_is_test boolean;
  v_tx_id uuid;
  v_balance_after numeric;
  v_pw_id uuid;
BEGIN
  v_is_test := (v_env = 'development');

  IF p_reference IS NULL OR length(trim(p_reference)) = 0 THEN
    RAISE EXCEPTION 'post_platform_entry: p_reference is required for idempotency';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'post_platform_entry: p_amount must be positive';
  END IF;
  IF p_transaction_type NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'post_platform_entry: p_transaction_type must be credit or debit';
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'on', true);

  SELECT id INTO v_pw_id FROM public.platform_wallet ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_pw_id IS NULL THEN
    INSERT INTO public.platform_wallet (balance, test_balance, total_earned, total_paid_out)
    VALUES (0,0,0,0) RETURNING id INTO v_pw_id;
  END IF;

  SELECT id INTO v_existing
  FROM public.wallet_transactions
  WHERE wallet_type = 'platform' AND reference = p_reference
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM set_config('app.bypass_balance_trigger', 'off', true);
    RETURN v_existing;
  END IF;

  v_delta := CASE WHEN p_transaction_type = 'credit' THEN p_amount ELSE -p_amount END;

  IF p_status = 'completed' THEN
    IF v_is_test THEN
      UPDATE public.platform_wallet
      SET test_balance = COALESCE(test_balance,0) + v_delta, updated_at = now()
      WHERE id = v_pw_id RETURNING test_balance INTO v_balance_after;
    ELSE
      UPDATE public.platform_wallet
      SET balance = COALESCE(balance,0) + v_delta,
          total_earned = COALESCE(total_earned,0) + GREATEST(v_delta,0),
          total_paid_out = COALESCE(total_paid_out,0) + GREATEST(-v_delta,0),
          updated_at = now()
      WHERE id = v_pw_id RETURNING balance INTO v_balance_after;
    END IF;
  ELSE
    SELECT CASE WHEN v_is_test THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
    INTO v_balance_after FROM public.platform_wallet WHERE id = v_pw_id;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, platform_wallet_id, wallet_type, transaction_type, category, amount,
    balance_after, reference, order_id, status, environment, notes, metadata
  ) VALUES (
    NULL, v_pw_id, 'platform', p_transaction_type, p_category, p_amount,
    v_balance_after, p_reference, p_order_id, p_status, v_env, p_notes,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_tx_id;

  PERFORM set_config('app.bypass_balance_trigger', 'off', true);
  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_platform_entry(numeric, text, text, text, text, text, uuid, text, jsonb) TO authenticated, service_role;