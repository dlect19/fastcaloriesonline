
CREATE OR REPLACE FUNCTION public.prevent_direct_balance_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only clamp balance columns for end-user (auth-scoped) sessions.
  -- Server-side callers (service_role, supabase_admin, postgres, and any
  -- SECURITY DEFINER function running as its owner) are trusted.
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
END; $$;

-- Delete both stale ledger rows so we can re-run the crediting cleanly
DELETE FROM public.wallet_transactions
 WHERE reference IN (
   'VH-CREDIT-06925c93-8229-4f8d-8d63-95786d58cee8',
   'VH-CREDIT-69c70ae3-e76e-4105-ade2-d325b3baea5d'
 );
DELETE FROM public.payout_pending_releases
 WHERE wallet_id = '47f10bd0-4dce-4783-b974-0a3a0c884880'
   AND category = 'voucher_sale';

SELECT public.credit_vendor_wallet_for_voucher('06925c93-8229-4f8d-8d63-95786d58cee8');
SELECT public.credit_vendor_wallet_for_voucher('69c70ae3-e76e-4105-ade2-d325b3baea5d');
