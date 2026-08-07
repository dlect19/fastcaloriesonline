-- ============================================================================
-- FASTCALORIES — PHASE 1 ACCOUNTING FOUNDATION (MIDNIGHT RUN)
-- Paste this WHOLE file into Cloud > Run SQL and run once, ideally 00:00–00:30
-- Lagos time when order traffic is lowest.
--
-- SAFE: adds indexes + one new function. It does NOT change any balance,
-- does NOT drop anything, and can be re-run without harm.
-- Expected runtime: a few seconds.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 — PRE-FLIGHT (must both return 0 rows; if not, STOP and tell me)
-- ---------------------------------------------------------------------------
SELECT 'duplicate order_financials' AS check, order_id, COUNT(*) AS copies
FROM public.order_financials
GROUP BY order_id HAVING COUNT(*) > 1;

SELECT 'duplicate ledger reference' AS check, wallet_id, reference, COUNT(*) AS copies
FROM public.wallet_transactions
WHERE reference IS NOT NULL AND wallet_id IS NOT NULL
GROUP BY wallet_id, reference HAVING COUNT(*) > 1;


-- ---------------------------------------------------------------------------
-- STEP 1 — One financial record per order
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS order_financials_order_id_uniq
  ON public.order_financials (order_id);


-- ---------------------------------------------------------------------------
-- STEP 2 — Idempotency: a reference may appear only once per wallet
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_wallet_reference_uniq
  ON public.wallet_transactions (wallet_id, reference)
  WHERE reference IS NOT NULL AND wallet_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- STEP 3 — The single safe money-posting primitive.
-- Every future credit/debit goes through this: it locks the wallet, refuses
-- duplicate references, moves the balance by a DELTA (never an absolute write),
-- and writes the ledger row in the same transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_wallet_entry(
  p_wallet_id uuid,
  p_wallet_type text,
  p_transaction_type text,          -- 'credit' | 'debit'
  p_category text,
  p_amount numeric,
  p_reference text,
  p_environment text DEFAULT 'production',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_target text DEFAULT 'balance',  -- 'balance' | 'eligible' | 'pending'
  p_status text DEFAULT 'completed'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_delta numeric;
  v_is_test boolean := (p_environment = 'development');
  v_tx_id uuid;
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

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;   -- already posted: no double money
  END IF;

  v_delta := CASE WHEN p_transaction_type = 'credit' THEN p_amount ELSE -p_amount END;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF p_status = 'completed' THEN
    IF p_target = 'balance' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET test_balance = COALESCE(test_balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      ELSE
        UPDATE public.wallets SET balance = COALESCE(balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      END IF;
    ELSIF p_target = 'eligible' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET test_eligible_balance = COALESCE(test_eligible_balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      ELSE
        UPDATE public.wallets SET eligible_balance = COALESCE(eligible_balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET test_pending_balance = COALESCE(test_pending_balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      ELSE
        UPDATE public.wallets SET pending_balance = COALESCE(pending_balance,0) + v_delta, updated_at = now() WHERE id = p_wallet_id;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount,
    reference, order_id, status, environment, notes, metadata
  ) VALUES (
    p_wallet_id, p_wallet_type, p_transaction_type, p_category, p_amount,
    p_reference, p_order_id, p_status, p_environment, p_notes, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_wallet_entry(uuid, text, text, text, numeric, text, text, uuid, text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_wallet_entry(uuid, text, text, text, numeric, text, text, uuid, text, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_wallet_entry(uuid, text, text, text, numeric, text, text, uuid, text, jsonb, text, text) TO service_role;


-- ---------------------------------------------------------------------------
-- STEP 4 — VERIFY (should show both indexes + the function)
-- ---------------------------------------------------------------------------
SELECT 'index' AS kind, indexname AS name
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('order_financials_order_id_uniq', 'wallet_transactions_wallet_reference_uniq')
UNION ALL
SELECT 'function', p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'post_wallet_entry';


-- ---------------------------------------------------------------------------
-- WALLET DRIFT CHECK (should return 0 rows if the repair scripts already ran)
-- ---------------------------------------------------------------------------
WITH led AS (
  SELECT wallet_id,
    SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount
             WHEN transaction_type='debit'  THEN -amount ELSE 0 END) AS ledger_balance
  FROM public.wallet_transactions WHERE environment='production' GROUP BY wallet_id
)
SELECT w.id, w.wallet_type, w.balance, COALESCE(l.ledger_balance,0) AS ledger_balance,
       ROUND(COALESCE(w.balance,0) - COALESCE(l.ledger_balance,0),2) AS drift
FROM public.wallets w LEFT JOIN led l ON l.wallet_id = w.id
WHERE ROUND(COALESCE(w.balance,0),2) <> ROUND(COALESCE(l.ledger_balance,0),2);
