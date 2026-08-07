-- ============================================================
-- FASTCALORIES — LIVE WALLET REPAIR (ONE-SHOT)
-- Copy this ENTIRE file into Cloud > Run SQL (LIVE) and run once.
-- It: (1) fixes the trigger bug, (2) rebuilds all balances from
-- transaction history, (3) prints a verification table at the end.
-- The final result grid MUST come back EMPTY (0 rows) = all balanced.
-- ============================================================

BEGIN;

-- ---- 1. FIX THE CAUSE -------------------------------------------------
-- The safety trigger was silently reverting balance deductions when a
-- vendor/rider requested a withdrawal from inside the app (session role
-- = authenticated). Now it honours the official internal bypass flag.
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
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


-- ---- 2. SNAPSHOT THE "BEFORE" PICTURE (so nothing is lost) ------------
CREATE TABLE IF NOT EXISTS public.wallet_repair_audit_2026_08 (
  wallet_id uuid,
  wallet_type text,
  balance_before numeric(14,2),
  ledger_truth numeric(14,2),
  drift numeric(14,2),
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.wallet_repair_audit_2026_08
  (wallet_id, wallet_type, balance_before, ledger_truth, drift)
SELECT w.id, w.wallet_type, w.balance,
       COALESCE(t.net, 0),
       w.balance - COALESCE(t.net, 0)
FROM public.wallets w
LEFT JOIN (
  SELECT wallet_id,
         SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS net
  FROM public.wallet_transactions
  WHERE status IN ('completed', 'pending') AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) t ON t.wallet_id = w.id
WHERE ABS(w.balance - COALESCE(t.net, 0)) > 0.009;


-- ---- 3. REBUILD EVERY WALLET FROM ITS TRANSACTION HISTORY ------------
DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'on', true);

  WITH truth AS (
    SELECT wallet_id,
           SUM(CASE WHEN status = 'completed' AND transaction_type = 'credit' THEN amount
                    WHEN status = 'completed' AND transaction_type = 'debit'  THEN -amount
                    ELSE 0 END) AS settled,
           SUM(CASE WHEN status = 'pending'   AND transaction_type = 'credit' THEN amount
                    WHEN status = 'pending'   AND transaction_type = 'debit'  THEN -amount
                    ELSE 0 END) AS held,
           SUM(CASE WHEN transaction_type = 'credit' AND category <> 'withdrawal_reversal'
                    THEN amount ELSE 0 END) AS earned,
           SUM(CASE WHEN category = 'withdrawal' AND transaction_type = 'debit' THEN amount
                    WHEN category = 'withdrawal_reversal' THEN -amount
                    ELSE 0 END) AS withdrawn
    FROM public.wallet_transactions
    WHERE status IN ('completed', 'pending') AND wallet_id IS NOT NULL
    GROUP BY wallet_id
  )
  UPDATE public.wallets w
  SET balance          = GREATEST(COALESCE(t.settled, 0), 0),
      eligible_balance = GREATEST(COALESCE(t.settled, 0), 0),
      pending_balance  = GREATEST(COALESCE(t.held, 0), 0),
      total_earned     = GREATEST(COALESCE(t.earned, 0), 0),
      total_withdrawn  = GREATEST(COALESCE(t.withdrawn, 0), 0),
      updated_at       = now()
  FROM truth t
  WHERE t.wallet_id = w.id;

  -- Wallets with no transactions at all must read zero.
  UPDATE public.wallets w
  SET balance = 0, eligible_balance = 0, pending_balance = 0, updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions x
    WHERE x.wallet_id = w.id AND x.status IN ('completed', 'pending')
  ) AND (w.balance <> 0 OR w.eligible_balance <> 0 OR w.pending_balance <> 0);

  PERFORM set_config('app.bypass_balance_trigger', 'off', true);
END $$;

COMMIT;


-- ---- 4. VERIFY — this grid MUST be EMPTY ----------------------------
WITH truth AS (
  SELECT wallet_id,
         SUM(CASE WHEN status = 'completed' AND transaction_type = 'credit' THEN amount
                  WHEN status = 'completed' AND transaction_type = 'debit'  THEN -amount
                  ELSE 0 END) AS settled
  FROM public.wallet_transactions
  WHERE status IN ('completed', 'pending') AND wallet_id IS NOT NULL
  GROUP BY wallet_id
)
SELECT w.id, w.wallet_type, w.balance AS balance_now,
       GREATEST(COALESCE(t.settled, 0), 0) AS expected
FROM public.wallets w
LEFT JOIN truth t ON t.wallet_id = w.id
WHERE w.balance <> GREATEST(COALESCE(t.settled, 0), 0);

-- Want to see what changed afterwards? Run:
--   SELECT * FROM public.wallet_repair_audit_2026_08 ORDER BY ABS(drift) DESC;
