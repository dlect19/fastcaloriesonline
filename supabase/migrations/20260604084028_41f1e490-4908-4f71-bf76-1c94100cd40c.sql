
-- Make the live "revenue pools" trigger settlement-aware so it doesn't immediately bump withdrawable balance
CREATE OR REPLACE FUNCTION public.update_vendor_revenue_pools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_released BOOLEAN;
BEGIN
  IF NEW.wallet_type != 'vendor' THEN
    RETURN NEW;
  END IF;

  -- Legacy: vendor_share posted as "pending" — keep adding to the pending bucket
  IF NEW.category = 'vendor_share' AND NEW.transaction_type = 'credit' AND NEW.status = 'pending' THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE public.wallets 
      SET test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + NEW.amount,
          test_pending_balance      = COALESCE(test_pending_balance, 0)      + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets 
      SET menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + NEW.amount,
          pending_balance       = COALESCE(pending_balance, 0)       + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  -- Completed vendor_share credit: route based on release_at vs now()
  IF NEW.category = 'vendor_share' AND NEW.transaction_type = 'credit' AND NEW.status = 'completed' THEN
    v_released := COALESCE(NEW.release_at, NEW.created_at, NOW()) <= NOW();
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF v_released THEN
      IF NEW.environment = 'development' THEN
        UPDATE public.wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + NEW.amount,
          test_balance               = COALESCE(test_balance, 0)               + NEW.amount,
          test_eligible_balance      = COALESCE(test_eligible_balance, 0)      + NEW.amount
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + NEW.amount,
          balance               = COALESCE(balance, 0)               + NEW.amount,
          eligible_balance      = COALESCE(eligible_balance, 0)      + NEW.amount
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF NEW.environment = 'development' THEN
        UPDATE public.wallets SET
          test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + NEW.amount,
          test_pending_balance       = COALESCE(test_pending_balance, 0)       + NEW.amount
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + NEW.amount,
          pending_balance       = COALESCE(pending_balance, 0)       + NEW.amount
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  -- Completed vendor_rider_share credit: same settlement gating
  IF NEW.category = 'vendor_rider_share' AND NEW.transaction_type = 'credit' AND NEW.status = 'completed' THEN
    v_released := COALESCE(NEW.release_at, NEW.created_at, NOW()) <= NOW();
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF v_released THEN
      IF NEW.environment = 'development' THEN
        UPDATE public.wallets SET
          test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + NEW.amount,
          test_balance               = COALESCE(test_balance, 0)               + NEW.amount,
          test_eligible_balance      = COALESCE(test_eligible_balance, 0)      + NEW.amount
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + NEW.amount,
          balance               = COALESCE(balance, 0)               + NEW.amount,
          eligible_balance      = COALESCE(eligible_balance, 0)      + NEW.amount
        WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      IF NEW.environment = 'development' THEN
        UPDATE public.wallets SET
          test_pending_balance = COALESCE(test_pending_balance, 0) + NEW.amount
        WHERE id = NEW.wallet_id;
      ELSE
        UPDATE public.wallets SET
          pending_balance = COALESCE(pending_balance, 0) + NEW.amount
        WHERE id = NEW.wallet_id;
      END IF;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  RETURN NEW;
END;
$function$;

-- Helper for the vendor dashboard: pending earnings still in settlement hold + next release time
CREATE OR REPLACE FUNCTION public.get_vendor_pending_settlement(p_wallet_id uuid, p_environment text DEFAULT NULL)
RETURNS TABLE(pending_total numeric, next_release_at timestamptz, item_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
BEGIN
  v_env := COALESCE(p_environment, get_platform_environment());
  RETURN QUERY
  SELECT
    COALESCE(SUM(amount), 0)::numeric,
    MIN(release_at),
    COUNT(*)::int
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id
    AND environment = v_env
    AND transaction_type = 'credit'
    AND status = 'completed'
    AND category IN ('vendor_share','vendor_rider_share')
    AND COALESCE(release_at, created_at) > NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vendor_pending_settlement(uuid, text) TO authenticated, service_role;
