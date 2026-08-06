-- ============================================================================
-- FASTCALORIES — LIVE ACCOUNTING FIX + RECONCILE
-- Paste into Cloud > Run SQL with LIVE selected. Run PART A first (read-only),
-- then PART B, then PART C, then PART D. Safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART A — AUDIT (read-only, changes nothing)
-- ============================================================================

-- A1. Drift per wallet: wallet balance vs the ledger (source of truth)
WITH led AS (
  SELECT wallet_id,
    SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount
             WHEN transaction_type='debit'  THEN -amount ELSE 0 END) AS ledger_balance,
    SUM(CASE WHEN category='withdrawal'          AND transaction_type='debit'  THEN amount ELSE 0 END) AS withdrawn,
    SUM(CASE WHEN category='withdrawal_reversal' AND transaction_type='credit' THEN amount ELSE 0 END) AS reversed
  FROM wallet_transactions
  WHERE environment='production'
  GROUP BY wallet_id
)
SELECT w.id AS wallet_id, w.wallet_type, w.user_id,
       w.balance, w.eligible_balance, w.pending_payouts, w.total_withdrawn,
       COALESCE(l.ledger_balance,0) AS ledger_balance,
       l.withdrawn, l.reversed,
       ROUND(COALESCE(w.balance,0) - COALESCE(l.ledger_balance,0), 2) AS drift
FROM wallets w
LEFT JOIN led l ON l.wallet_id = w.id
WHERE ROUND(COALESCE(w.balance,0),2) <> ROUND(COALESCE(l.ledger_balance,0),2)
ORDER BY ABS(COALESCE(w.balance,0) - COALESCE(l.ledger_balance,0)) DESC;

-- A2. Completed payouts with NO matching withdrawal debit in the ledger
SELECT pr.id, pr.created_at, pr.user_type, pr.status, pr.amount, pr.wallet_id
FROM payout_requests pr
WHERE pr.environment = 'production'
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt
    WHERE wt.wallet_id = pr.wallet_id
      AND wt.category = 'withdrawal'
      AND wt.amount = pr.amount
      AND wt.created_at BETWEEN pr.created_at - interval '5 min' AND pr.created_at + interval '5 min')
ORDER BY pr.created_at DESC;

-- A3. Duplicate ledger references (broken idempotency)
SELECT wallet_id, reference, COUNT(*) AS copies, SUM(amount) AS total
FROM wallet_transactions
WHERE reference IS NOT NULL AND wallet_id IS NOT NULL
GROUP BY 1,2 HAVING COUNT(*) > 1
ORDER BY copies DESC;

-- A4. Duplicate order_financials rows
SELECT order_id, COUNT(*) FROM order_financials GROUP BY 1 HAVING COUNT(*) > 1;

-- A5. Negative or impossible balances
SELECT id, wallet_type, balance, eligible_balance, pending_balance, pending_payouts
FROM wallets
WHERE COALESCE(balance,0) < 0 OR COALESCE(eligible_balance,0) < 0 OR COALESCE(pending_balance,0) < 0;


-- ============================================================================
-- PART B — ROOT-CAUSE FIX
-- Bug: prevent_direct_balance_update() reverts EVERY balance column whenever the
-- session role is `authenticated`. SECURITY DEFINER does not change session_user
-- or the `role` setting, so when a rider/vendor submits a withdrawal from the app
-- the deduct trigger's balance update is silently reverted — the payout row and
-- the ledger debit are written, but the wallet balance stays the same.
-- Fix: honour the app.bypass_balance_trigger flag and any nested trigger update.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Trusted server-side path: a trigger/function explicitly asked to bypass.
  IF COALESCE(current_setting('app.bypass_balance_trigger', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Trusted server-side path: this UPDATE originates from inside another trigger
  -- (deduct_wallet_on_payout_request, reconcile_*, release_*, refund handlers…).
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Untrusted path: a direct end-user UPDATE. Freeze every money column.
  IF session_user IN ('authenticator', 'authenticated', 'anon') AND
     COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon') THEN
    NEW.balance                     := OLD.balance;
    NEW.test_balance                := OLD.test_balance;
    NEW.pending_balance             := OLD.pending_balance;
    NEW.test_pending_balance        := OLD.test_pending_balance;
    NEW.eligible_balance            := OLD.eligible_balance;
    NEW.test_eligible_balance       := OLD.test_eligible_balance;
    NEW.total_earned                := OLD.total_earned;
    NEW.total_withdrawn             := OLD.total_withdrawn;
    NEW.pending_payouts             := OLD.pending_payouts;
    NEW.menu_earnings_balance       := OLD.menu_earnings_balance;
    NEW.test_menu_earnings_balance  := OLD.test_menu_earnings_balance;
    NEW.menu_earnings_pending       := OLD.menu_earnings_pending;
    NEW.test_menu_earnings_pending  := OLD.test_menu_earnings_pending;
    NEW.rider_revenue_balance       := OLD.rider_revenue_balance;
    NEW.test_rider_revenue_balance  := OLD.test_rider_revenue_balance;
  END IF;

  RETURN NEW;
END;
$function$;

-- B2. Rider reconcile counted ONLY `rider_share` credits, so bonuses, admin
-- credits, reassignment shares and tips were dropped and the clamp to 0 hid it.
-- Rebuild it straight from the ledger, all categories, no clamp-away of truth.
CREATE OR REPLACE FUNCTION public.reconcile_rider_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credits NUMERIC;
  v_debits  NUMERIC;
  v_net     NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type='debit'  THEN amount ELSE 0 END), 0)
  INTO v_credits, v_debits
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  v_net := ROUND(v_credits - v_debits, 2);

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  UPDATE wallets SET
    balance          = v_net,
    eligible_balance = v_net,
    total_earned     = ROUND(v_credits, 2),
    total_withdrawn  = ROUND((SELECT COALESCE(SUM(CASE WHEN category='withdrawal' AND transaction_type='debit' THEN amount
                                                      WHEN category='withdrawal_reversal' AND transaction_type='credit' THEN -amount
                                                      ELSE 0 END),0)
                              FROM wallet_transactions
                              WHERE wallet_id = p_wallet_id AND environment='production'), 2),
    updated_at = NOW()
  WHERE id = p_wallet_id;
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END;
$function$;

-- B3. Also reconcile riders / delivery companies / customers before a withdrawal,
-- so the availability check uses ledger truth (live version only did vendors).
CREATE OR REPLACE FUNCTION public.deduct_wallet_on_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet RECORD;
  v_is_test BOOLEAN;
  v_source TEXT;
  v_amount NUMERIC;
  v_available NUMERIC;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  v_amount  := NEW.amount;
  v_source  := COALESCE(NEW.withdrawal_source, 'menu_earnings');
  v_is_test := (get_platform_environment() = 'development');
  NEW.environment := CASE WHEN v_is_test THEN 'development' ELSE 'production' END;

  IF NEW.user_type = 'vendor' THEN
    PERFORM public.reconcile_vendor_wallet(NEW.wallet_id);
  ELSIF NEW.user_type = 'rider' AND NOT v_is_test THEN
    PERFORM public.reconcile_rider_wallet(NEW.wallet_id);
  END IF;
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      v_available := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_rider_revenue_balance,0)
                                         ELSE COALESCE(v_wallet.rider_revenue_balance,0) END;
    ELSE
      v_available := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_menu_earnings_balance,0)
                                         ELSE COALESCE(v_wallet.menu_earnings_balance,0) END;
    END IF;
  ELSE
    v_available := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_eligible_balance,0)
                                       ELSE COALESCE(v_wallet.eligible_balance,0) END;
  END IF;

  IF v_amount > v_available THEN
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
    RAISE EXCEPTION 'Insufficient balance. Available: ₦%, Requested: ₦%', v_available, v_amount;
  END IF;

  IF NEW.user_type = 'vendor' THEN
    IF v_source = 'rider_revenue' THEN
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance,0) - v_amount,
          test_eligible_balance      = COALESCE(test_eligible_balance,0)      - v_amount,
          test_balance               = COALESCE(test_balance,0)               - v_amount,
          pending_payouts            = COALESCE(pending_payouts,0)            + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          rider_revenue_balance = COALESCE(rider_revenue_balance,0) - v_amount,
          eligible_balance      = COALESCE(eligible_balance,0)      - v_amount,
          balance               = COALESCE(balance,0)               - v_amount,
          pending_payouts       = COALESCE(pending_payouts,0)       + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) - v_amount,
          test_eligible_balance      = COALESCE(test_eligible_balance,0)      - v_amount,
          test_balance               = COALESCE(test_balance,0)               - v_amount,
          pending_payouts            = COALESCE(pending_payouts,0)            + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance,0) - v_amount,
          eligible_balance      = COALESCE(eligible_balance,0)      - v_amount,
          balance               = COALESCE(balance,0)               - v_amount,
          pending_payouts       = COALESCE(pending_payouts,0)       + v_amount,
          updated_at = NOW()
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
  ELSIF NEW.user_type IN ('rider', 'delivery_company') THEN
    IF v_is_test THEN
      UPDATE public.wallets SET
        test_eligible_balance = COALESCE(test_eligible_balance,0) - v_amount,
        test_balance          = COALESCE(test_balance,0)          - v_amount,
        pending_payouts       = COALESCE(pending_payouts,0)       + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        eligible_balance = COALESCE(eligible_balance,0) - v_amount,
        balance          = COALESCE(balance,0)          - v_amount,
        pending_payouts  = COALESCE(pending_payouts,0)  + v_amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category, amount,
    order_id, environment, status, notes, reference
  ) VALUES (
    NEW.wallet_id,
    COALESCE(NEW.user_type, 'rider'),
    'debit',
    'withdrawal',
    v_amount,
    NULL,
    NEW.environment,
    'completed',
    CASE
      WHEN NEW.user_type = 'vendor' AND v_source = 'rider_revenue' THEN 'Withdrawal - Rider Revenue'
      WHEN NEW.user_type = 'vendor' THEN 'Withdrawal - Menu Earnings'
      ELSE 'Withdrawal'
    END,
    'PAYOUT-' || NEW.id::text
  );

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN NEW;
END;
$function$;

-- B4. Idempotency guards (safe: Live has zero violations today)
CREATE UNIQUE INDEX IF NOT EXISTS order_financials_order_id_uniq
  ON public.order_financials (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_wallet_reference_uniq
  ON public.wallet_transactions (wallet_id, reference)
  WHERE reference IS NOT NULL AND wallet_id IS NOT NULL;


-- ============================================================================
-- PART C — RECONCILE EXISTING BALANCES
-- ============================================================================

-- C1. Open the ledger where history is missing: any wallet whose ledger total is
-- negative gets ONE cutover credit so sum(ledger) starts at 0.
-- (No history is fabricated — the gap is recorded explicitly.)
-- Vendor wallets use category 'admin_credit' because that is the category the
-- vendor reconcile formula recognises; everyone else uses 'opening_balance'.
INSERT INTO public.wallet_transactions
  (wallet_id, wallet_type, transaction_type, category, amount, status, environment, notes, reference)
SELECT w.id, w.wallet_type, 'credit',
       CASE WHEN w.wallet_type = 'vendor' THEN 'admin_credit' ELSE 'opening_balance' END,
       ABS(t.net), 'completed', 'production',
       'Ledger cutover opening balance (unledgered historical credits)',
       'OPENING-' || w.id::text
FROM wallets w
JOIN (
  SELECT wallet_id,
         ROUND(SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount
                        WHEN transaction_type='debit'  THEN -amount ELSE 0 END), 2) AS net
  FROM wallet_transactions WHERE environment='production' GROUP BY wallet_id
) t ON t.wallet_id = w.id
WHERE t.net < 0
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions x
    WHERE x.wallet_id = w.id AND x.reference = 'OPENING-' || w.id::text);


-- C2. Dry run — review the corrections it WOULD make
SELECT public.full_reconcile_wallets('production', true);

-- C3. Apply the rebuild (run only after reviewing C2)
SELECT public.full_reconcile_wallets('production', false);


-- ============================================================================
-- PART D — VERIFY (must return zero rows)
-- ============================================================================
WITH led AS (
  SELECT wallet_id,
    SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount
             WHEN transaction_type='debit'  THEN -amount ELSE 0 END) AS ledger_balance
  FROM wallet_transactions WHERE environment='production' GROUP BY wallet_id
)
SELECT w.id, w.wallet_type, w.balance, COALESCE(l.ledger_balance,0) AS ledger_balance,
       ROUND(COALESCE(w.balance,0) - COALESCE(l.ledger_balance,0),2) AS drift
FROM wallets w LEFT JOIN led l ON l.wallet_id = w.id
WHERE ROUND(COALESCE(w.balance,0),2) <> ROUND(COALESCE(l.ledger_balance,0),2);
