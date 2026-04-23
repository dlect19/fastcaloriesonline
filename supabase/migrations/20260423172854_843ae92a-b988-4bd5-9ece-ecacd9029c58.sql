
-- 1. Patch the credit_vendor_on_payment trigger to skip commission and wallet credit for POS sales
CREATE OR REPLACE FUNCTION public.credit_vendor_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor RECORD;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_commission_rate NUMERIC;
  v_platform_commission NUMERIC;
  v_vendor_share NUMERIC;
  v_service_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_menu_price NUMERIC;
  v_packaging_fee NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
  v_existing_rider_tx UUID;
  v_delivery_fee NUMERIC;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_rider_profile_id UUID;
  v_delivery_company_id UUID;
  v_rider_wallet_id UUID;
  v_company_wallet_id UUID;
  v_company_user_id UUID;
  v_affiliated_vendor_id UUID;
  v_affiliated_vendor_wallet_id UUID;
  v_rider_commission_rate NUMERIC;
  v_logistics_commission_rate NUMERIC;
  v_payout_final_pay NUMERIC;
  v_payout_platform_fee NUMERIC;
  v_fee_pct NUMERIC;
  v_fee_min NUMERIC;
  v_fee_max NUMERIC;
  v_raw_platform_fee NUMERIC;
  v_gross_commission NUMERIC;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN

    PERFORM set_config('app.bypass_balance_trigger', 'true', true);

    SELECT id INTO v_existing_tx FROM wallet_transactions
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN
      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- POS SALES: customer pays vendor directly in-store. Platform never
    -- received money for the vendor, so we DO NOT credit the vendor
    -- wallet, DO NOT charge commission, and DO NOT record platform
    -- revenue. We still write a neutral order_financials row so reports
    -- show the order with vendor_payout = full menu price (already
    -- collected in cash) and zero commission / zero company revenue.
    -- ─────────────────────────────────────────────────────────────────
    IF COALESCE(NEW.channel, '') = 'pos' THEN
      v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
      v_packaging_fee := COALESCE(NEW.packaging_fee, 0);

      INSERT INTO order_financials (
        order_id, outlet_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
        promo_discount_amount, promo_type, promo_source, vendor_payout,
        company_revenue, revenue_status, environment, service_fee_amount
      ) VALUES (
        NEW.id, NEW.outlet_id, v_menu_price, 0, 0,
        0, NULL, NULL,
        v_menu_price + v_packaging_fee, 0, 'break_even', NEW.environment,
        0
      )
      ON CONFLICT (order_id) DO NOTHING;

      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;

    v_is_test := (NEW.environment = 'development');

    SELECT v.user_id INTO v_vendor
    FROM vendors v
    WHERE v.id = NEW.vendor_id;

    IF NEW.outlet_id IS NOT NULL THEN
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;

      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type, outlet_id)
        VALUES (v_vendor.user_id, 'vendor', NEW.outlet_id)
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    ELSE
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id IS NULL;

      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (v_vendor.user_id, 'vendor')
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    END IF;

    -- Delegate to the existing implementation by calling the original logic
    -- via dynamic execution would be complex; instead, run the legacy non-POS path inline
    -- by calling a helper function that contains the rest of the original body.
    PERFORM public.credit_vendor_on_payment_non_pos(NEW.id);

    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  RETURN NEW;
END;
$function$;

-- The simplest robust approach: keep the original function intact for non-POS
-- by NOT actually splitting it. Replace the above with a single function that
-- short-circuits POS at the top and otherwise contains the full original body.
-- We re-define the function fully here to avoid relying on a helper.

CREATE OR REPLACE FUNCTION public.credit_vendor_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor RECORD;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_commission_rate NUMERIC;
  v_platform_commission NUMERIC;
  v_vendor_share NUMERIC;
  v_service_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_menu_price NUMERIC;
  v_packaging_fee NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
  v_existing_rider_tx UUID;
  v_delivery_fee NUMERIC;
  v_rider_share NUMERIC;
  v_platform_delivery_share NUMERIC;
  v_rider_profile_id UUID;
  v_delivery_company_id UUID;
  v_rider_wallet_id UUID;
  v_company_wallet_id UUID;
  v_company_user_id UUID;
  v_affiliated_vendor_id UUID;
  v_affiliated_vendor_wallet_id UUID;
  v_rider_commission_rate NUMERIC;
  v_logistics_commission_rate NUMERIC;
  v_payout_final_pay NUMERIC;
  v_payout_platform_fee NUMERIC;
  v_fee_pct NUMERIC;
  v_fee_min NUMERIC;
  v_fee_max NUMERIC;
  v_raw_platform_fee NUMERIC;
  v_gross_commission NUMERIC;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN

    PERFORM set_config('app.bypass_balance_trigger', 'true', true);

    SELECT id INTO v_existing_tx FROM wallet_transactions
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN
      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;

    -- POS sales bypass commission, wallet credit, and platform revenue.
    -- Customer pays vendor directly in-store; nothing flows through the platform.
    IF COALESCE(NEW.channel, '') = 'pos' THEN
      v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
      v_packaging_fee := COALESCE(NEW.packaging_fee, 0);

      INSERT INTO order_financials (
        order_id, outlet_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
        promo_discount_amount, promo_type, promo_source, vendor_payout,
        company_revenue, revenue_status, environment, service_fee_amount
      ) VALUES (
        NEW.id, NEW.outlet_id, v_menu_price, 0, 0,
        0, NULL, NULL,
        v_menu_price + v_packaging_fee, 0, 'break_even', NEW.environment,
        0
      )
      ON CONFLICT (order_id) DO NOTHING;

      PERFORM set_config('app.bypass_balance_trigger', 'false', true);
      RETURN NEW;
    END IF;

    v_is_test := (NEW.environment = 'development');

    SELECT v.user_id INTO v_vendor
    FROM vendors v
    WHERE v.id = NEW.vendor_id;

    IF NEW.outlet_id IS NOT NULL THEN
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id = NEW.outlet_id;

      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type, outlet_id)
        VALUES (v_vendor.user_id, 'vendor', NEW.outlet_id)
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    ELSE
      SELECT id INTO v_vendor_wallet_id FROM wallets
      WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor' AND outlet_id IS NULL;

      IF v_vendor_wallet_id IS NULL THEN
        INSERT INTO wallets (user_id, wallet_type)
        VALUES (v_vendor.user_id, 'vendor')
        RETURNING id INTO v_vendor_wallet_id;
      END IF;
    END IF;

    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;

    v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
    v_packaging_fee := COALESCE(NEW.packaging_fee, 0);
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_service_fee := COALESCE(NEW.service_fee, 0);

    v_commission_rate := resolve_commission_rate('vendor', NEW.vendor_id);

    v_gross_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    v_platform_commission := GREATEST(0, v_gross_commission - v_promo_discount);
    v_vendor_share := v_menu_price - v_platform_commission + v_packaging_fee;
    v_company_revenue := v_platform_commission + v_service_fee;

    IF v_promo_discount > v_gross_commission THEN
      v_company_revenue := v_company_revenue - (v_promo_discount - v_gross_commission);
    END IF;

    IF v_company_revenue > 0 THEN
      v_revenue_status := 'profit';
    ELSIF v_company_revenue = 0 THEN
      v_revenue_status := 'break_even';
    ELSE
      v_revenue_status := 'loss';
    END IF;

    v_rider_commission_rate := NULL;
    v_logistics_commission_rate := NULL;

    INSERT INTO order_financials (
      order_id, outlet_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
      promo_discount_amount, promo_type, promo_source, vendor_payout,
      company_revenue, revenue_status, environment, service_fee_amount
    ) VALUES (
      NEW.id, NEW.outlet_id, v_menu_price, v_commission_rate, v_platform_commission,
      v_promo_discount,
      CASE WHEN NEW.promo_code IS NOT NULL THEN 'promo_code' ELSE NULL END,
      NEW.promo_code,
      v_vendor_share, v_company_revenue, v_revenue_status, NEW.environment,
      v_service_fee
    )
    ON CONFLICT (order_id) DO NOTHING;

    -- Credit vendor wallet
    IF v_is_test THEN
      UPDATE wallets SET
        test_balance = COALESCE(test_balance, 0) + v_vendor_share,
        updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
    ELSE
      UPDATE wallets SET
        balance = COALESCE(balance, 0) + v_vendor_share,
        total_earned = COALESCE(total_earned, 0) + v_vendor_share,
        updated_at = NOW()
      WHERE id = v_vendor_wallet_id;
    END IF;

    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'vendor', 'vendor_share', 'credit', v_vendor_share, NEW.id,
      v_vendor_wallet_id, NEW.environment, 'completed',
      'Vendor share for order #' || NEW.order_number
    );

    -- Credit platform wallet
    IF v_platform_wallet_id IS NOT NULL AND v_company_revenue > 0 THEN
      IF v_is_test THEN
        UPDATE platform_wallet SET test_balance = COALESCE(test_balance, 0) + v_company_revenue, updated_at = NOW()
        WHERE id = v_platform_wallet_id;
      ELSE
        UPDATE platform_wallet SET balance = COALESCE(balance, 0) + v_company_revenue, updated_at = NOW()
        WHERE id = v_platform_wallet_id;
      END IF;

      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'platform_commission', 'credit', v_company_revenue, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Commission + service fee for order #' || NEW.order_number
      );
    END IF;

    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Backfill the 3 existing wrongly-charged POS orders.
--    Reverse vendor wallet credits + platform wallet credits, then fix order_financials.
DO $$
DECLARE
  o RECORD;
  tx RECORD;
  v_outlet_id UUID;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_is_test BOOLEAN;
  v_menu_price NUMERIC;
  v_packaging_fee NUMERIC;
BEGIN
  FOR o IN
    SELECT id, vendor_id, outlet_id, environment, subtotal, menu_subtotal, packaging_fee, discount, order_number
    FROM orders WHERE channel = 'pos'
  LOOP
    v_is_test := (o.environment = 'development');
    v_menu_price := COALESCE(o.menu_subtotal, o.subtotal + COALESCE(o.discount, 0));
    v_packaging_fee := COALESCE(o.packaging_fee, 0);

    PERFORM set_config('app.bypass_balance_trigger', 'true', true);

    -- Reverse vendor_share credit (one per order)
    FOR tx IN
      SELECT id, wallet_id, amount FROM wallet_transactions
      WHERE order_id = o.id AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed'
    LOOP
      IF v_is_test THEN
        UPDATE wallets SET test_balance = COALESCE(test_balance, 0) - tx.amount, updated_at = NOW()
        WHERE id = tx.wallet_id;
      ELSE
        UPDATE wallets SET
          balance = COALESCE(balance, 0) - tx.amount,
          total_earned = GREATEST(0, COALESCE(total_earned, 0) - tx.amount),
          updated_at = NOW()
        WHERE id = tx.wallet_id;
      END IF;

      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes
      ) VALUES (
        'vendor', 'pos_correction', 'debit', -tx.amount, o.id,
        tx.wallet_id, o.environment, 'completed',
        'Reversal: POS sale ' || o.order_number || ' was incorrectly credited (paid in cash directly to vendor)'
      );
    END LOOP;

    -- Reverse platform_commission credit (one per order)
    FOR tx IN
      SELECT id, wallet_id, amount FROM wallet_transactions
      WHERE order_id = o.id AND category = 'platform_commission' AND transaction_type = 'credit' AND status = 'completed'
    LOOP
      IF v_is_test THEN
        UPDATE platform_wallet SET test_balance = COALESCE(test_balance, 0) - tx.amount, updated_at = NOW()
        WHERE id = tx.wallet_id;
      ELSE
        UPDATE platform_wallet SET balance = COALESCE(balance, 0) - tx.amount, updated_at = NOW()
        WHERE id = tx.wallet_id;
      END IF;

      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'pos_correction', 'debit', -tx.amount, o.id,
        tx.wallet_id, o.environment, 'completed',
        'Reversal: POS sale ' || o.order_number || ' was incorrectly recorded as platform revenue'
      );
    END LOOP;

    -- Fix order_financials
    UPDATE order_financials SET
      menu_price = v_menu_price,
      vendor_commission_percentage = 0,
      vendor_commission_amount = 0,
      promo_discount_amount = 0,
      vendor_payout = v_menu_price + v_packaging_fee,
      company_revenue = 0,
      revenue_status = 'break_even',
      service_fee_amount = 0
    WHERE order_id = o.id;

    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END LOOP;
END$$;
