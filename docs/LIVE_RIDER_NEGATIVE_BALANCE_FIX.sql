-- ============================================================================
-- FASTCALORIES — LIVE RIDER NEGATIVE BALANCE FIX
-- Copy this ENTIRE script into Cloud > Run SQL with LIVE selected, then run once.
-- Negative live balances remain visible as platform debt.
-- Withdrawable remains zero until later earnings fully repay that debt.
-- ============================================================================

BEGIN;

-- Allow trusted accounting functions to update money columns while continuing
-- to block direct balance edits from customer/vendor/rider clients.
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.bypass_balance_trigger', true), 'off')
     IN ('on', 'true') THEN
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF session_user IN ('authenticator', 'authenticated', 'anon')
     AND COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon') THEN
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

-- Rebuild a rider wallet from every completed ledger entry. Live balance may
-- be negative; withdrawable is never negative.
CREATE OR REPLACE FUNCTION public.reconcile_rider_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_environment text;
  v_credits numeric;
  v_debits numeric;
  v_net numeric;
  v_withdrawn numeric;
BEGIN
  v_environment := public.get_platform_environment();

  SELECT
    COALESCE(SUM(CASE
      WHEN transaction_type = 'credit' AND status = 'completed' THEN amount
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN transaction_type = 'debit' AND status = 'completed' THEN amount
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN category = 'withdrawal' AND transaction_type = 'debit'
           AND status = 'completed' THEN amount
      WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit'
           AND status = 'completed' THEN -amount
      ELSE 0 END), 0)
  INTO v_credits, v_debits, v_withdrawn
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_environment;

  v_net := ROUND(v_credits - v_debits, 2);
  PERFORM set_config('app.bypass_balance_trigger', 'on', true);

  IF v_environment = 'development' THEN
    UPDATE public.wallets
    SET test_balance = v_net,
        test_eligible_balance = GREATEST(v_net, 0),
        total_earned = ROUND(v_credits, 2),
        total_withdrawn = ROUND(v_withdrawn, 2),
        updated_at = now()
    WHERE id = p_wallet_id AND wallet_type = 'rider';
  ELSE
    UPDATE public.wallets
    SET balance = v_net,
        eligible_balance = GREATEST(v_net, 0),
        total_earned = ROUND(v_credits, 2),
        total_withdrawn = ROUND(v_withdrawn, 2),
        updated_at = now()
    WHERE id = p_wallet_id AND wallet_type = 'rider';
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'off', true);
END;
$function$;

-- Always refresh rider ledger truth immediately before the existing payout
-- deduction trigger checks whether a withdrawal is affordable.
CREATE OR REPLACE FUNCTION public.reconcile_rider_before_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.user_type = 'rider' THEN
    PERFORM public.reconcile_rider_wallet(NEW.wallet_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aaa_reconcile_rider_before_payout
  ON public.payout_requests;
CREATE TRIGGER aaa_reconcile_rider_before_payout
BEFORE INSERT ON public.payout_requests
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_rider_before_payout();

-- Repair every rider wallet now, including OLUWAPELUMI MICHAEL AKANBI.
DO $block$
DECLARE
  rider_wallet record;
BEGIN
  FOR rider_wallet IN
    SELECT id FROM public.wallets WHERE wallet_type = 'rider'
  LOOP
    PERFORM public.reconcile_rider_wallet(rider_wallet.id);
  END LOOP;
END;
$block$;

COMMIT;

-- FINAL CHECK: shows rider balances and ledger truth.
-- For the affected rider, live_balance should be -1217.20 and withdrawable 0.
WITH ledger AS (
  SELECT wallet_id,
         ROUND(SUM(CASE
           WHEN transaction_type = 'credit' AND status = 'completed' THEN amount
           WHEN transaction_type = 'debit' AND status = 'completed' THEN -amount
           ELSE 0 END), 2) AS ledger_balance
  FROM public.wallet_transactions
  WHERE environment = 'production'
  GROUP BY wallet_id
)
SELECT p.full_name,
       w.id AS wallet_id,
       w.balance AS live_balance,
       w.eligible_balance AS withdrawable,
       COALESCE(l.ledger_balance, 0) AS ledger_balance,
       ROUND(w.balance - COALESCE(l.ledger_balance, 0), 2) AS difference
FROM public.wallets w
LEFT JOIN public.profiles p ON p.user_id = w.user_id
LEFT JOIN ledger l ON l.wallet_id = w.id
WHERE w.wallet_type = 'rider'
ORDER BY p.full_name NULLS LAST;