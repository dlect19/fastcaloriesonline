-- ============================================================
-- FASTCALORIES — SIMPLE LIVE WALLET REPAIR
-- Run in Cloud > Run SQL with LIVE selected.
-- Run each STEP one at a time, top to bottom.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 — SEE THE PROBLEM (read-only, changes nothing)
-- "balance_shown" = what the app displays
-- "ledger_truth"  = what the transaction history adds up to
-- "drift"         = the error. Should be 0.00 for everyone.
-- ------------------------------------------------------------
WITH truth AS (
  SELECT wallet_id,
         SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS net
  FROM wallet_transactions
  WHERE status IN ('completed', 'pending')
    AND wallet_id IS NOT NULL
  GROUP BY wallet_id
)
SELECT w.id AS wallet_id,
       w.wallet_type,
       w.balance          AS balance_shown,
       COALESCE(t.net, 0) AS ledger_truth,
       w.balance - COALESCE(t.net, 0) AS drift
FROM wallets w
LEFT JOIN truth t ON t.wallet_id = w.id
WHERE ABS(w.balance - COALESCE(t.net, 0)) > 0.009
ORDER BY ABS(w.balance - COALESCE(t.net, 0)) DESC;


-- ------------------------------------------------------------
-- STEP 2 — FIX THE CAUSE
-- The safety trigger was cancelling the balance deduction when a
-- vendor/rider requested a withdrawal from inside the app.
-- This makes it respect the official bypass flag used by the
-- withdrawal trigger, so future withdrawals actually deduct.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Trusted internal writers (withdrawal trigger, ledger trigger,
  -- reconciliation) set this flag before touching balances.
  IF COALESCE(current_setting('app.bypass_balance_trigger', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF session_user IN ('authenticator', 'authenticated', 'anon') AND
     current_setting('role', true) IN ('authenticated', 'anon') THEN
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
  END IF;
  RETURN NEW;
END;
$function$;


-- ------------------------------------------------------------
-- STEP 3 — REBUILD EVERY WALLET FROM ITS TRANSACTION HISTORY
-- After this, what the app shows = the sum of the transactions.
-- ------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'on', true);

  WITH truth AS (
    SELECT wallet_id,
           SUM(CASE WHEN status = 'completed' AND transaction_type = 'credit'  THEN amount
                    WHEN status = 'completed' AND transaction_type = 'debit'   THEN -amount
                    ELSE 0 END) AS settled,
           SUM(CASE WHEN status = 'pending'   AND transaction_type = 'credit'  THEN amount
                    WHEN status = 'pending'   AND transaction_type = 'debit'   THEN -amount
                    ELSE 0 END) AS held,
           SUM(CASE WHEN transaction_type = 'credit' AND category <> 'withdrawal_reversal'
                    THEN amount ELSE 0 END) AS earned,
           SUM(CASE WHEN category = 'withdrawal' AND transaction_type = 'debit' THEN amount
                    WHEN category = 'withdrawal_reversal' THEN -amount
                    ELSE 0 END) AS withdrawn
    FROM wallet_transactions
    WHERE status IN ('completed', 'pending') AND wallet_id IS NOT NULL
    GROUP BY wallet_id
  )
  UPDATE wallets w
  SET balance          = GREATEST(COALESCE(t.settled, 0), 0),
      eligible_balance = GREATEST(COALESCE(t.settled, 0), 0),
      pending_balance  = GREATEST(COALESCE(t.held, 0), 0),
      total_earned     = GREATEST(COALESCE(t.earned, 0), 0),
      total_withdrawn  = GREATEST(COALESCE(t.withdrawn, 0), 0),
      updated_at       = now()
  FROM truth t
  WHERE t.wallet_id = w.id;

  -- Wallets with no transactions at all must read zero.
  UPDATE wallets w
  SET balance = 0, eligible_balance = 0, pending_balance = 0, updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM wallet_transactions x
    WHERE x.wallet_id = w.id AND x.status IN ('completed', 'pending')
  ) AND (w.balance <> 0 OR w.eligible_balance <> 0 OR w.pending_balance <> 0);

  PERFORM set_config('app.bypass_balance_trigger', 'off', true);
END $$;


-- ------------------------------------------------------------
-- STEP 4 — VERIFY. This must return ZERO rows.
-- ------------------------------------------------------------
WITH truth AS (
  SELECT wallet_id,
         SUM(CASE WHEN status = 'completed' AND transaction_type = 'credit' THEN amount
                  WHEN status = 'completed' AND transaction_type = 'debit'  THEN -amount
                  ELSE 0 END) AS settled
  FROM wallet_transactions
  WHERE status IN ('completed', 'pending') AND wallet_id IS NOT NULL
  GROUP BY wallet_id
)
SELECT w.id, w.wallet_type, w.balance, GREATEST(COALESCE(t.settled, 0), 0) AS expected
FROM wallets w
LEFT JOIN truth t ON t.wallet_id = w.id
WHERE w.balance <> GREATEST(COALESCE(t.settled, 0), 0);
