INSERT INTO public.platform_settings (key, value, description)
VALUES
  ('vendor_settlement_mode_restaurant', 'hours', 'Restaurant vendor settlement mode: instant, hours, next_day, or third_day'),
  ('vendor_settlement_mode_pharmacy', 'hours', 'Pharmacy vendor settlement mode: instant, hours, next_day, or third_day'),
  ('vendor_settlement_mode_market', 'hours', 'Market vendor settlement mode: instant, hours, next_day, or third_day')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vendor_settlement_release_at(
  p_earned_at timestamptz DEFAULT now(),
  p_wallet_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timing text;
  v_category text;
  v_hours numeric := 0;
BEGIN
  SELECT lower(COALESCE(v.category, vo.store_type, 'restaurant'))
  INTO v_category
  FROM public.wallets w
  LEFT JOIN public.vendors v ON v.user_id = w.user_id
  LEFT JOIN public.vendor_outlets vo ON vo.id = w.outlet_id
  WHERE w.id = p_wallet_id
  LIMIT 1;

  v_category := CASE
    WHEN v_category LIKE '%pharm%' THEN 'pharmacy'
    WHEN v_category LIKE '%market%' OR v_category LIKE '%grocery%' THEN 'market'
    ELSE 'restaurant'
  END;

  SELECT value INTO v_timing
  FROM public.platform_settings
  WHERE key = 'vendor_settlement_mode_' || v_category
  LIMIT 1;

  IF v_timing IS NULL THEN
    SELECT COALESCE(value, 'instant') INTO v_timing
    FROM public.platform_settings
    WHERE key = 'vendor_settlement_timing'
    LIMIT 1;
  END IF;

  v_timing := COALESCE(v_timing, 'instant');

  IF v_timing = 'next_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day';
  ELSIF v_timing = 'third_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '3 days';
  ELSIF v_timing = 'hours' THEN
    SELECT COALESCE(NULLIF(value, '')::numeric, 0) INTO v_hours
    FROM public.platform_settings
    WHERE key = 'settlement_hours_' || v_category
    LIMIT 1;

    RETURN p_earned_at + (COALESCE(v_hours, 0) * INTERVAL '1 hour');
  END IF;

  RETURN p_earned_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vendor_pending_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_release_at timestamptz;
BEGIN
  IF NEW.wallet_type != 'vendor' OR NEW.category != 'vendor_share' OR NEW.transaction_type != 'credit' THEN
    RETURN NEW;
  END IF;

  v_release_at := public.vendor_settlement_release_at(COALESCE(NEW.created_at, NOW()), NEW.wallet_id);

  IF NEW.status = 'completed' THEN
    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      COALESCE(NEW.created_at, NOW()), COALESCE(v_release_at, NOW()), TRUE, NOW(), NEW.environment
    )
    ON CONFLICT (transaction_id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF v_release_at <= NOW() THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE public.wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - NEW.amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - NEW.amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);

    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, released_at, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      COALESCE(NEW.created_at, NOW()), NOW(), TRUE, NOW(), NEW.environment
    )
    ON CONFLICT (transaction_id) DO NOTHING;
  ELSE
    INSERT INTO public.payout_pending_releases (
      wallet_id, transaction_id, amount, wallet_type, category,
      earned_at, release_at, released, environment
    ) VALUES (
      NEW.wallet_id, NEW.id, NEW.amount, NEW.wallet_type, NEW.category,
      COALESCE(NEW.created_at, NOW()), v_release_at, FALSE, NEW.environment
    )
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_pending_vendor_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  released_count INTEGER := 0;
  tx RECORD;
  v_is_test BOOLEAN;
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  FOR tx IN
    SELECT wt.id, wt.wallet_id, wt.amount, wt.environment, wt.created_at
    FROM public.wallet_transactions wt
    WHERE wt.category = 'vendor_share'
      AND wt.status = 'pending'
      AND wt.wallet_id IS NOT NULL
      AND public.vendor_settlement_release_at(COALESCE(wt.created_at, NOW()), wt.wallet_id) <= NOW()
  LOOP
    v_is_test := (tx.environment = 'development');

    IF v_is_test THEN
      UPDATE public.wallets SET
        test_pending_balance = GREATEST(COALESCE(test_pending_balance, 0) - tx.amount, 0),
        test_eligible_balance = COALESCE(test_eligible_balance, 0) + tx.amount,
        test_balance = COALESCE(test_balance, 0) + tx.amount,
        test_menu_earnings_pending = GREATEST(COALESCE(test_menu_earnings_pending, 0) - tx.amount, 0),
        test_menu_earnings_balance = COALESCE(test_menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    ELSE
      UPDATE public.wallets SET
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - tx.amount, 0),
        eligible_balance = COALESCE(eligible_balance, 0) + tx.amount,
        balance = COALESCE(balance, 0) + tx.amount,
        menu_earnings_pending = GREATEST(COALESCE(menu_earnings_pending, 0) - tx.amount, 0),
        menu_earnings_balance = COALESCE(menu_earnings_balance, 0) + tx.amount,
        updated_at = NOW()
      WHERE id = tx.wallet_id;
    END IF;

    UPDATE public.wallet_transactions
    SET status = 'completed',
        notes = 'Released by vendor settlement schedule',
        updated_at = NOW()
    WHERE id = tx.id;

    UPDATE public.payout_pending_releases
    SET released = TRUE, released_at = NOW(), updated_at = NOW()
    WHERE transaction_id = tx.id AND NOT released;

    released_count := released_count + 1;
  END LOOP;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_vendor_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;
  v_rider_balance NUMERIC;
  v_total_earned NUMERIC;
  v_env TEXT;
  v_is_test BOOLEAN;
BEGIN
  v_env := get_platform_environment();
  v_is_test := (v_env = 'development');

  SELECT COALESCE(SUM(CASE 
    WHEN category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
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

  SELECT COALESCE(SUM(amount), 0) INTO v_menu_pending
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env
    AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'pending';

  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'vendor_rider_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND COALESCE(notes, '') ILIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND COALESCE(notes, '') ILIKE '%Rider Revenue%' THEN amount
    ELSE 0
  END), 0) INTO v_rider_balance
  FROM public.wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = v_env;

  v_total_earned := v_menu_balance + v_menu_pending + v_rider_balance;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  IF v_is_test THEN
    UPDATE public.wallets SET
      test_menu_earnings_balance = GREATEST(v_menu_balance, 0),
      test_menu_earnings_pending = GREATEST(v_menu_pending, 0),
      test_rider_revenue_balance = GREATEST(v_rider_balance, 0),
      test_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      test_pending_balance = GREATEST(v_menu_pending, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  ELSE
    UPDATE public.wallets SET
      menu_earnings_balance = GREATEST(v_menu_balance, 0),
      menu_earnings_pending = GREATEST(v_menu_pending, 0),
      rider_revenue_balance = GREATEST(v_rider_balance, 0),
      balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
      pending_balance = GREATEST(v_menu_pending, 0),
      total_earned = GREATEST(v_total_earned, 0),
      updated_at = NOW()
    WHERE id = p_wallet_id;
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_vendor_revenue_pools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.wallet_type != 'vendor' THEN
    RETURN NEW;
  END IF;

  IF NEW.category = 'vendor_share' AND NEW.transaction_type = 'credit' AND NEW.status = 'pending' THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE public.wallets 
      SET test_menu_earnings_pending = COALESCE(test_menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets 
      SET menu_earnings_pending = COALESCE(menu_earnings_pending, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  IF NEW.category = 'vendor_rider_share' AND NEW.transaction_type = 'credit' AND NEW.status = 'completed' THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    IF NEW.environment = 'development' THEN
      UPDATE public.wallets 
      SET test_rider_revenue_balance = COALESCE(test_rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    ELSE
      UPDATE public.wallets 
      SET rider_revenue_balance = COALESCE(rider_revenue_balance, 0) + NEW.amount
      WHERE id = NEW.wallet_id;
    END IF;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN SELECT id FROM public.wallets WHERE wallet_type = 'vendor'
  LOOP
    PERFORM public.reconcile_vendor_wallet(w.id);
  END LOOP;
END;
$$;