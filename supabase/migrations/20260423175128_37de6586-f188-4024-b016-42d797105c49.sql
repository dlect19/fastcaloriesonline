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
  v_existing_fin UUID;
  v_menu_price NUMERIC;
  v_packaging_fee NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
  v_commission_rate_actual NUMERIC;
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

    -- POS sales: customer pays vendor directly in-store. No commission, no wallet credit.
    IF COALESCE(NEW.channel, '') = 'pos' THEN
      v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
      v_packaging_fee := COALESCE(NEW.packaging_fee, 0);

      SELECT id INTO v_existing_fin FROM order_financials WHERE order_id = NEW.id LIMIT 1;
      IF v_existing_fin IS NULL THEN
        INSERT INTO order_financials (
          order_id, outlet_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
          promo_discount_amount, promo_type, promo_source, vendor_payout,
          company_revenue, revenue_status, environment, service_fee_amount
        ) VALUES (
          NEW.id, NEW.outlet_id, v_menu_price, 0, 0,
          0, NULL, NULL,
          v_menu_price + v_packaging_fee, 0, 'break_even', NEW.environment,
          0
        );
      END IF;

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

    SELECT id INTO v_existing_fin FROM order_financials WHERE order_id = NEW.id LIMIT 1;
    IF v_existing_fin IS NULL THEN
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
      );
    END IF;

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
