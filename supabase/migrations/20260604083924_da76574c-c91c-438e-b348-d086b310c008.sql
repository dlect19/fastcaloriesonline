
-- 1) Add release_at to wallet_transactions to enforce per-row settlement period
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS release_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_release_at
  ON public.wallet_transactions (wallet_id, release_at)
  WHERE category IN ('vendor_share','vendor_rider_share');

-- 2) Trigger: populate release_at for vendor earnings using vendor_settlement_release_at(wallet)
CREATE OR REPLACE FUNCTION public.set_vendor_tx_release_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_type = 'credit'
     AND NEW.category IN ('vendor_share','vendor_rider_share')
     AND NEW.release_at IS NULL THEN
    BEGIN
      NEW.release_at := public.vendor_settlement_release_at(COALESCE(NEW.created_at, NOW()), NEW.wallet_id);
    EXCEPTION WHEN OTHERS THEN
      NEW.release_at := COALESCE(NEW.created_at, NOW());
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_vendor_tx_release_at ON public.wallet_transactions;
CREATE TRIGGER trg_set_vendor_tx_release_at
  BEFORE INSERT ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_vendor_tx_release_at();

-- 3) Backfill historical rows
UPDATE public.wallet_transactions wt
SET release_at = public.vendor_settlement_release_at(wt.created_at, wt.wallet_id)
WHERE wt.release_at IS NULL
  AND wt.transaction_type = 'credit'
  AND wt.category IN ('vendor_share','vendor_rider_share');

-- 4) Update reconcile_vendor_wallet so eligible/menu/rider balance EXCLUDES un-released credits,
--    and pending_balance INCLUDES both status='pending' and un-released completed credits.
CREATE OR REPLACE FUNCTION public.reconcile_vendor_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;        -- status=pending vendor_share credits
  v_menu_unreleased NUMERIC;     -- completed vendor_share credits whose release_at > now()
  v_rider_balance NUMERIC;
  v_rider_unreleased NUMERIC;
  v_total_earned NUMERIC;
  v_env TEXT;
  v_is_test BOOLEAN;
BEGIN
  v_env := get_platform_environment();
  v_is_test := (v_env = 'development');

  -- Released menu balance (vendor_share completed AND released, plus debits/adjustments)
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed'
         AND COALESCE(release_at, created_at) <= NOW() THEN amount
    WHEN category = 'vendor_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND COALESCE(notes, '') NOT ILIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND COALESCE(notes, '') NOT ILIKE '%Rider Revenue%' THEN amount
    WHEN category = 'admin_debit' AND transaction_type = 'debit' THEN -amount
    WHEN category = 'admin_credit' AND transaction_type = 'credit' THEN amount
    WHEN category = 'dispute_deduction' AND transaction_type = 'debit' THEN -amount
    WHEN category = 'adjustment' AND transaction_type = 'debit' THEN -amount
    WHEN category = 'adjustment' AND transaction_type = 'credit' THEN amount
    ELSE 0
  END), 0) INTO v_menu_balance
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  -- vendor_share with status='pending' (legacy pending bucket)
  SELECT COALESCE(SUM(amount), 0) INTO v_menu_pending
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env
    AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'pending';

  -- completed vendor_share credits still in settlement hold
  SELECT COALESCE(SUM(amount), 0) INTO v_menu_unreleased
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env
    AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed'
    AND COALESCE(release_at, created_at) > NOW();

  -- Released rider revenue
  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed'
         AND COALESCE(release_at, created_at) <= NOW() THEN amount
    WHEN category = 'vendor_rider_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND COALESCE(notes, '') ILIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND COALESCE(notes, '') ILIKE '%Rider Revenue%' THEN amount
    ELSE 0
  END), 0) INTO v_rider_balance
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  -- Rider revenue still in settlement hold
  SELECT COALESCE(SUM(amount), 0) INTO v_rider_unreleased
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env
    AND category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed'
    AND COALESCE(release_at, created_at) > NOW();

  v_total_earned := v_menu_balance + v_menu_pending + v_menu_unreleased + v_rider_balance + v_rider_unreleased;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF v_is_test THEN
    UPDATE public.wallets SET
      test_menu_earnings_balance = GREATEST(v_menu_balance, 0),
      test_menu_earnings_pending = GREATEST(v_menu_pending + v_menu_unreleased, 0),
      test_rider_revenue_balance = GREATEST(v_rider_balance, 0),
      test_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_pending_balance = GREATEST(v_menu_pending + v_menu_unreleased + v_rider_unreleased, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  ELSE
    UPDATE public.wallets SET
      menu_earnings_balance = GREATEST(v_menu_balance, 0),
      menu_earnings_pending = GREATEST(v_menu_pending + v_menu_unreleased, 0),
      rider_revenue_balance = GREATEST(v_rider_balance, 0),
      balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      pending_balance = GREATEST(v_menu_pending + v_menu_unreleased + v_rider_unreleased, 0),
      total_earned = GREATEST(v_total_earned, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END;
$$;

-- 5) Reconcile all existing vendor wallets so cached balances reflect new logic
DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN SELECT id FROM public.wallets WHERE wallet_type = 'vendor' LOOP
    BEGIN
      PERFORM public.reconcile_vendor_wallet(w.id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- 6) Helper: lookup current settlement config for a wallet (used by UI to show release time)
CREATE OR REPLACE FUNCTION public.get_vendor_settlement_info(p_wallet_id uuid)
RETURNS TABLE(category text, mode text, hours numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat text;
  v_mode text;
  v_hours numeric := 0;
BEGIN
  SELECT lower(COALESCE(v.category::text, vo.store_type::text, 'restaurant'))
  INTO v_cat
  FROM public.wallets w
  LEFT JOIN public.vendors v ON v.user_id = w.user_id
  LEFT JOIN public.vendor_outlets vo ON vo.id = w.outlet_id
  WHERE w.id = p_wallet_id
  LIMIT 1;

  v_cat := CASE
    WHEN v_cat LIKE '%pharm%' THEN 'pharmacy'
    WHEN v_cat LIKE '%market%' OR v_cat LIKE '%grocery%' THEN 'market'
    ELSE 'restaurant'
  END;

  SELECT value INTO v_mode FROM public.platform_settings WHERE key = 'vendor_settlement_mode_' || v_cat LIMIT 1;
  IF v_mode IS NULL THEN
    SELECT value INTO v_mode FROM public.platform_settings WHERE key = 'vendor_settlement_timing' LIMIT 1;
  END IF;
  v_mode := COALESCE(v_mode, 'instant');

  IF v_mode = 'hours' THEN
    SELECT COALESCE(NULLIF(value,'')::numeric, 0) INTO v_hours
    FROM public.platform_settings WHERE key = 'settlement_hours_' || v_cat LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_cat, v_mode, COALESCE(v_hours, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vendor_settlement_info(uuid) TO authenticated, service_role;
