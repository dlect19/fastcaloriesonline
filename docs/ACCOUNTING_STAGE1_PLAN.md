# Accounting Hardening — Stage 1 (prepared, not yet applied)

Status: **BLOCKED** — the Test/Dev backend is unreachable (SQL API and pooler both
time out, management endpoints return 403), so migrations cannot be applied.
The Live database is healthy and was audited read-only.

## Auditor decisions (taken on the user's behalf — lowest-risk options)

1. **Money precision** — keep `numeric(14,2)`. A kobo/integer migration would touch
   every wallet, order and payout path for no correctness gain; `numeric` is exact.
2. **Corrections style** — reversing ledger entries only. No direct balance edits.
3. **Legacy tables** — `vendor_wallets` and `transactions` to be frozen read-only
   *after* a code sweep confirms no writer remains (Stage 2, not Stage 1).
4. **Test vs Live money** — keep the existing `test_*` columns. Splitting schemas now
   would break every edge function for no accounting benefit.
5. **Unledgered historical credits** — do **not** fabricate history. Open the ledger at
   a cutover timestamp with one `opening_balance` entry per wallet so
   `sum(ledger) = wallet.balance` from cutover forward.

## Live pre-flight checks (passed)

- `order_financials`: 0 duplicate `order_id` rows → unique index is safe.
- `wallet_transactions`: 0 duplicate `(wallet_id, reference)` pairs → unique index is safe.

## Stage 1 SQL (apply once the Test backend is back)

```sql
-- 1. One financial record per order
CREATE UNIQUE INDEX IF NOT EXISTS order_financials_order_id_uniq
  ON public.order_financials (order_id);

-- 2. Idempotency: a reference may only appear once per wallet
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_wallet_reference_uniq
  ON public.wallet_transactions (wallet_id, reference)
  WHERE reference IS NOT NULL AND wallet_id IS NOT NULL;

-- 3. Atomic + idempotent ledger posting primitive
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
    RETURN v_existing;
  END IF;

  v_delta := CASE WHEN p_transaction_type = 'credit' THEN p_amount ELSE -p_amount END;

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
```

## Stage 2 (after Stage 1 lands)

1. Sweep every edge function that does read-modify-write on `wallets` and route it
   through `post_wallet_entry`, passing a deterministic reference
   (`ORDER-<id>-VENDOR_SHARE`, `PAYOUT-<id>`, `REFUND-<order>-<party>`, …).
2. Cutover `opening_balance` entries for the 15 Live wallets that fail reconciliation.
3. Freeze `vendor_wallets` / `transactions` once no writer remains.
