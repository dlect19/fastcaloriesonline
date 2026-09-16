-- =====================================================================
-- Server-authoritative customer checkout + atomic wallet payment.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_customer_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vendor_id uuid := (p_payload ->> 'vendor_id')::uuid;
  v_outlet_id uuid := NULLIF(p_payload ->> 'outlet_id', '')::uuid;
  v_delivery_type text := COALESCE(p_payload ->> 'delivery_type', 'delivery');
  v_quote_id uuid := NULLIF(p_payload ->> 'delivery_quote_id', '')::uuid;
  v_fingerprint text := NULLIF(p_payload ->> 'checkout_fingerprint', '');
  v_attempt_key text := NULLIF(p_payload ->> 'checkout_attempt_key', '');
  v_expected_total numeric := NULLIF(p_payload ->> 'expected_total', '')::numeric;
  v_category text;
  v_existing public.orders;
  v_order public.orders;
  v_item jsonb;
  v_addon jsonb;
  v_product public.products;
  v_combo public.combos;
  v_portion public.product_portions;
  v_qty numeric;
  v_unit numeric;
  v_addon_sum numeric;
  v_addon_cal integer;
  v_charged_subtotal numeric := 0;
  v_menu_subtotal numeric := 0;
  v_free_value numeric := 0;
  v_calories integer := 0;
  v_packaging numeric := GREATEST(0, COALESCE((p_payload ->> 'packaging_fee')::numeric, 0));
  v_extra_pkg numeric := GREATEST(0, COALESCE((p_payload ->> 'extra_package_fee')::numeric, 0));
  v_package_count integer := GREATEST(1, COALESCE((p_payload ->> 'package_count')::integer, 1));
  v_requested_discount numeric := GREATEST(0, COALESCE((p_payload ->> 'discount')::numeric, 0));
  v_promo_code text := NULLIF(p_payload ->> 'promo_code', '');
  v_max_discount numeric;
  v_discount numeric;
  v_service_fee numeric;
  v_delivery_fee numeric := 0;
  v_total numeric;
  v_quote public.delivery_quotes;
  v_pkg_ids uuid[] := ARRAY[]::uuid[];
  v_pkg jsonb;
  v_pkg_id uuid;
  v_idx integer;
  v_item_id uuid;
  v_is_free boolean;
  v_original numeric;
  v_unit_multiplier numeric;
  v_purchase_unit text;
  v_items jsonb := COALESCE(p_payload -> 'items', '[]'::jsonb);
  v_free_promo uuid := NULLIF(p_payload ->> 'free_meal_promo_id', '')::uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'VENDOR_REQUIRED';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART';
  END IF;
  IF v_delivery_type NOT IN ('delivery', 'self_pickup') THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_TYPE';
  END IF;

  -- Serialise concurrent attempts for the same customer + checkout context.
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text || '|' || COALESCE(v_fingerprint, v_attempt_key, 'none')));

  -- Idempotency: an existing order for this attempt key, or a still-unpaid order
  -- for the same checkout fingerprint, is the canonical order for this attempt.
  IF v_attempt_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.orders
    WHERE checkout_attempt_key = v_attempt_key AND user_id = v_uid
    LIMIT 1;
  END IF;

  IF v_existing.id IS NULL AND v_fingerprint IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.orders
    WHERE user_id = v_uid
      AND checkout_fingerprint = v_fingerprint
      AND status <> 'cancelled'
      AND payment_status <> 'paid'
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'resumed', true,
      'total', v_existing.total,
      'delivery_fee', v_existing.delivery_fee,
      'service_fee', v_existing.service_fee,
      'discount', v_existing.discount,
      'payment_status', v_existing.payment_status
    );
  END IF;

  SELECT category::text INTO v_category FROM public.vendors WHERE id = v_vendor_id;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;

  IF v_outlet_id IS NOT NULL THEN
    PERFORM 1 FROM public.vendor_outlets
    WHERE id = v_outlet_id AND vendor_id = v_vendor_id AND is_active AND is_approved;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OUTLET_UNAVAILABLE';
    END IF;
  END IF;

  -- ---- authoritative repricing of every line -------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := COALESCE((v_item ->> 'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY';
    END IF;
    v_is_free := COALESCE((v_item ->> 'is_free_meal')::boolean, false);
    v_purchase_unit := CASE WHEN (v_item ->> 'purchase_unit') = 'sachet' THEN 'sachet' ELSE 'pack' END;
    v_addon_sum := 0;
    v_addon_cal := 0;

    IF NULLIF(v_item ->> 'combo_id', '') IS NOT NULL THEN
      SELECT * INTO v_combo FROM public.combos WHERE id = (v_item ->> 'combo_id')::uuid;
      IF v_combo.id IS NULL OR NOT v_combo.is_available OR v_combo.vendor_id <> v_vendor_id THEN
        RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', COALESCE(v_item ->> 'product_name', 'item');
      END IF;
      v_unit := v_combo.combo_price;
    ELSE
      SELECT * INTO v_product FROM public.products WHERE id = (v_item ->> 'product_id')::uuid;
      IF v_product.id IS NULL OR v_product.vendor_id <> v_vendor_id THEN
        RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', COALESCE(v_item ->> 'product_name', 'item');
      END IF;
      IF NOT public.product_effective_available(v_product.id, v_outlet_id) THEN
        RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', v_product.name;
      END IF;

      -- quantity rules
      IF COALESCE(v_product.min_order_qty, 1) > v_qty THEN
        RAISE EXCEPTION 'MINIMUM_QUANTITY_NOT_MET:%', v_product.name;
      END IF;
      IF v_product.max_order_qty IS NOT NULL AND v_qty > v_product.max_order_qty THEN
        RAISE EXCEPTION 'MAXIMUM_QUANTITY_EXCEEDED:%', v_product.name;
      END IF;
      IF NOT COALESCE(v_product.allows_fractional_qty, false) AND v_qty <> floor(v_qty) THEN
        RAISE EXCEPTION 'INVALID_PURCHASE_INCREMENT:%', v_product.name;
      END IF;
      IF COALESCE(v_product.qty_step, 1) > 0
         AND abs((v_qty / COALESCE(v_product.qty_step, 1)) - round(v_qty / COALESCE(v_product.qty_step, 1))) > 0.0001 THEN
        RAISE EXCEPTION 'INVALID_PURCHASE_INCREMENT:%', v_product.name;
      END IF;
      IF v_purchase_unit = 'sachet' AND NOT COALESCE(v_product.allows_sachet, false) THEN
        RAISE EXCEPTION 'PACK_SIZE_REQUIRED:%', v_product.name;
      END IF;

      IF v_purchase_unit = 'sachet' THEN
        v_unit := COALESCE(v_product.sachet_price, v_product.price);
      ELSIF NULLIF(v_item ->> 'portion_id', '') IS NOT NULL THEN
        SELECT * INTO v_portion FROM public.product_portions
        WHERE id = (v_item ->> 'portion_id')::uuid AND product_id = v_product.id AND is_available;
        IF v_portion.id IS NULL THEN
          RAISE EXCEPTION 'INVALID_OPTION:%', v_product.name;
        END IF;
        v_unit := v_portion.price;
      ELSE
        v_unit := COALESCE(v_product.discount_price, v_product.price);
      END IF;

      -- add-ons priced from configuration only
      FOR v_addon IN SELECT * FROM jsonb_array_elements(COALESCE(v_item -> 'addons', '[]'::jsonb))
      LOOP
        IF NULLIF(v_addon ->> 'addon_item_id', '') IS NULL THEN
          CONTINUE;
        END IF;
        SELECT COALESCE(ai.additional_price, 0), COALESCE(ai.calories, 0)
          INTO v_unit, v_addon_cal
        FROM public.addon_items ai WHERE id = (v_addon ->> 'addon_item_id')::uuid AND ai.is_available
        LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'INVALID_OPTION:%', COALESCE(v_addon ->> 'item_name', 'add-on');
        END IF;
      END LOOP;
    END IF;

    -- recompute add-on total separately (kept out of the unit lookup above)
    SELECT COALESCE(SUM(ai.additional_price), 0), COALESCE(SUM(ai.calories), 0)
      INTO v_addon_sum, v_addon_cal
    FROM jsonb_array_elements(COALESCE(v_item -> 'addons', '[]'::jsonb)) a
    JOIN public.addon_items ai ON ai.id = NULLIF(a ->> 'addon_item_id', '')::uuid AND ai.is_available;

    IF NULLIF(v_item ->> 'combo_id', '') IS NULL AND NULLIF(v_item ->> 'product_id', '') IS NOT NULL THEN
      IF v_purchase_unit = 'sachet' THEN
        v_unit := COALESCE(v_product.sachet_price, v_product.price);
      ELSIF NULLIF(v_item ->> 'portion_id', '') IS NOT NULL THEN
        SELECT price INTO v_unit FROM public.product_portions WHERE id = (v_item ->> 'portion_id')::uuid;
      ELSE
        v_unit := COALESCE(v_product.discount_price, v_product.price);
      END IF;
    END IF;

    v_unit := COALESCE(v_unit, 0) + COALESCE(v_addon_sum, 0);
    v_original := v_unit;

    v_menu_subtotal := v_menu_subtotal + v_original * v_qty;
    IF v_is_free THEN
      v_free_value := v_free_value + v_original * v_qty;
    ELSE
      v_charged_subtotal := v_charged_subtotal + v_unit * v_qty;
    END IF;
    v_calories := v_calories + COALESCE((v_item ->> 'calories')::integer, 0);
  END LOOP;

  -- ---- fees, discounts, total ---------------------------------------
  v_extra_pkg := LEAST(v_extra_pkg, GREATEST(0, v_package_count - 1) * 1000);
  v_packaging := LEAST(v_packaging, GREATEST(2000, v_charged_subtotal * 0.5));

  v_max_discount := public.max_allowed_order_discount(v_uid, v_menu_subtotal, v_promo_code);
  v_discount := LEAST(v_requested_discount, v_max_discount, v_charged_subtotal);

  v_service_fee := public.compute_service_fee(v_charged_subtotal, v_delivery_type, v_category);

  IF v_delivery_type = 'delivery' THEN
    IF v_quote_id IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_QUOTE_REQUIRED';
    END IF;
    SELECT * INTO v_quote FROM public.delivery_quotes
    WHERE id = v_quote_id AND user_id = v_uid AND vendor_id = v_vendor_id
      AND consumed_order_id IS NULL AND expires_at > now();
    IF v_quote.id IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_QUOTE_STALE';
    END IF;
    IF v_quote.checkout_fingerprint IS NOT NULL AND v_fingerprint IS NOT NULL
       AND v_quote.checkout_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'DELIVERY_QUOTE_CHECKOUT_MISMATCH';
    END IF;
    v_delivery_fee := v_quote.delivery_fee + v_extra_pkg;
  ELSE
    v_delivery_fee := 0;
    v_extra_pkg := 0;
  END IF;

  v_total := ROUND(v_charged_subtotal + v_packaging + v_delivery_fee + v_service_fee - v_discount, 2);

  -- Never charge more than the customer was shown.
  IF v_expected_total IS NOT NULL AND v_total > v_expected_total + 1 THEN
    RAISE EXCEPTION 'PRICING_CHANGED:% expected % server %', '', v_expected_total, v_total;
  END IF;

  PERFORM set_config('app.authoritative_checkout', 'true', true);

  INSERT INTO public.orders (
    user_id, vendor_id, outlet_id, order_number, channel,
    checkout_attempt_key, checkout_fingerprint, delivery_quote_id,
    menu_subtotal, subtotal, packaging_fee, delivery_fee, service_fee, discount, total,
    total_calories, promo_code, delivery_type, delivery_address_id, delivery_address_text,
    delivery_instructions, delivery_latitude, delivery_longitude,
    delivery_distance_km, delivery_pricing_source,
    status, payment_status, payment_method,
    package_count, extra_package_fee,
    is_free_meal, free_meal_value, free_meal_promo_id,
    is_preorder, prep_days, estimated_ready_at
  ) VALUES (
    v_uid, v_vendor_id, v_outlet_id, '', 'online',
    v_attempt_key, v_fingerprint, CASE WHEN v_delivery_type = 'delivery' THEN v_quote_id ELSE NULL END,
    v_menu_subtotal, v_charged_subtotal + v_packaging - v_discount, v_packaging, v_delivery_fee,
    v_service_fee, v_discount, v_total,
    v_calories, v_promo_code, v_delivery_type, NULLIF(p_payload ->> 'delivery_address_id', '')::uuid,
    p_payload ->> 'delivery_address_text',
    NULLIF(p_payload ->> 'delivery_instructions', ''),
    CASE WHEN v_delivery_type = 'delivery' THEN NULLIF(p_payload ->> 'delivery_latitude', '')::numeric END,
    CASE WHEN v_delivery_type = 'delivery' THEN NULLIF(p_payload ->> 'delivery_longitude', '')::numeric END,
    CASE WHEN v_delivery_type = 'delivery' THEN v_quote.distance_km END,
    CASE WHEN v_delivery_type = 'delivery' THEN v_quote.source ELSE 'carryout' END,
    'pending', 'pending', 'wallet',
    v_package_count, v_extra_pkg,
    v_free_value > 0, v_free_value, v_free_promo,
    COALESCE((p_payload ->> 'is_preorder')::boolean, false),
    NULLIF(p_payload ->> 'prep_days', '')::integer,
    NULLIF(p_payload ->> 'estimated_ready_at', '')::timestamptz
  )
  RETURNING * INTO v_order;

  -- packages
  v_idx := 0;
  FOR v_pkg IN SELECT * FROM jsonb_array_elements(
                 CASE WHEN jsonb_array_length(COALESCE(p_payload -> 'packages', '[]'::jsonb)) > 0
                      THEN p_payload -> 'packages' ELSE '[{}]'::jsonb END)
  LOOP
    INSERT INTO public.order_packages (order_id, recipient_name, note, sort_order)
    VALUES (v_order.id,
            COALESCE(NULLIF(v_pkg ->> 'recipient_name', ''), 'Package ' || (v_idx + 1)),
            NULLIF(v_pkg ->> 'note', ''), v_idx)
    RETURNING id INTO v_pkg_id;
    v_pkg_ids := v_pkg_ids || v_pkg_id;
    v_idx := v_idx + 1;
  END LOOP;

  -- items (repriced again from configuration, never from the payload)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item ->> 'quantity')::numeric;
    v_is_free := COALESCE((v_item ->> 'is_free_meal')::boolean, false);
    v_purchase_unit := CASE WHEN (v_item ->> 'purchase_unit') = 'sachet' THEN 'sachet' ELSE 'pack' END;

    SELECT COALESCE(SUM(ai.additional_price), 0) INTO v_addon_sum
    FROM jsonb_array_elements(COALESCE(v_item -> 'addons', '[]'::jsonb)) a
    JOIN public.addon_items ai ON ai.id = NULLIF(a ->> 'addon_item_id', '')::uuid AND ai.is_available;

    IF NULLIF(v_item ->> 'combo_id', '') IS NOT NULL THEN
      SELECT combo_price INTO v_unit FROM public.combos WHERE id = (v_item ->> 'combo_id')::uuid;
      v_unit_multiplier := 1;
    ELSE
      SELECT * INTO v_product FROM public.products WHERE id = (v_item ->> 'product_id')::uuid;
      IF v_purchase_unit = 'sachet' THEN
        v_unit := COALESCE(v_product.sachet_price, v_product.price);
        v_unit_multiplier := 1;
      ELSIF NULLIF(v_item ->> 'portion_id', '') IS NOT NULL THEN
        SELECT price INTO v_unit FROM public.product_portions WHERE id = (v_item ->> 'portion_id')::uuid;
        v_unit_multiplier := 1;
      ELSE
        v_unit := COALESCE(v_product.discount_price, v_product.price);
        v_unit_multiplier := CASE WHEN COALESCE(v_product.allows_sachet, false)
                                    AND COALESCE(v_product.sachets_per_pack, 0) > 0
                                  THEN v_product.sachets_per_pack ELSE 1 END;
      END IF;
    END IF;

    v_unit := COALESCE(v_unit, 0) + COALESCE(v_addon_sum, 0);
    v_idx := COALESCE((v_item ->> 'package_index')::integer, 0);

    INSERT INTO public.order_items (
      order_id, package_id, product_id, product_name, quantity,
      unit_price, total_price, original_unit_price, is_free_meal_item, free_qty,
      calories, special_instructions, purchase_unit, unit_multiplier,
      portion_label, portion_size, portion_unit
    ) VALUES (
      v_order.id,
      CASE WHEN v_idx + 1 <= array_length(v_pkg_ids, 1) THEN v_pkg_ids[v_idx + 1] ELSE v_pkg_ids[1] END,
      NULLIF(v_item ->> 'product_id', '')::uuid,
      COALESCE(v_item ->> 'product_name', 'Item'),
      v_qty,
      CASE WHEN v_is_free THEN v_unit ELSE v_unit END,
      CASE WHEN v_is_free THEN v_unit * v_qty ELSE v_unit * v_qty END,
      CASE WHEN v_is_free THEN v_unit END,
      v_is_free,
      CASE WHEN v_is_free THEN COALESCE((v_item ->> 'free_qty')::integer, v_qty::integer) END,
      COALESCE((v_item ->> 'calories')::integer, 0),
      NULLIF(v_item ->> 'special_instructions', ''),
      v_purchase_unit,
      COALESCE(v_unit_multiplier, 1),
      NULLIF(v_item ->> 'portion_label', ''),
      NULLIF(v_item ->> 'portion_size', '')::numeric,
      NULLIF(v_item ->> 'portion_unit', '')
    )
    RETURNING id INTO v_item_id;

    FOR v_addon IN SELECT * FROM jsonb_array_elements(COALESCE(v_item -> 'addons', '[]'::jsonb))
    LOOP
      IF NULLIF(v_addon ->> 'addon_item_id', '') IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.order_item_addons (
        order_item_id, addon_group_name, addon_item_name, additional_price, calories, image_url
      )
      SELECT v_item_id,
             COALESCE(v_addon ->> 'group_name', ag.name, 'Options'),
             ai.name, COALESCE(ai.additional_price, 0), COALESCE(ai.calories, 0),
             NULLIF(v_addon ->> 'image_url', '')
      FROM public.addon_items ai
      LEFT JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
      WHERE ai.id = (v_addon ->> 'addon_item_id')::uuid;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'resumed', false,
    'menu_subtotal', v_order.menu_subtotal,
    'subtotal', v_order.subtotal,
    'packaging_fee', v_order.packaging_fee,
    'delivery_fee', v_order.delivery_fee,
    'service_fee', v_order.service_fee,
    'discount', v_order.discount,
    'total', v_order.total,
    'payment_status', v_order.payment_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- Atomic, idempotent wallet payment
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_orders_with_wallet(
  p_order_ids uuid[],
  p_reference text,
  p_environment text DEFAULT 'production'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_wallet public.wallets;
  v_order public.orders;
  v_total numeric := 0;
  v_balance numeric;
  v_is_test boolean := (p_environment = 'development');
  v_results jsonb := '[]'::jsonb;
  v_ref text;
  v_already boolean;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ORDER_IDS_REQUIRED';
  END IF;
  IF p_reference IS NULL OR length(trim(p_reference)) = 0 THEN
    RAISE EXCEPTION 'REFERENCE_REQUIRED';
  END IF;

  -- Lock every order for the duration of the transaction.
  FOR v_order IN
    SELECT * FROM public.orders WHERE id = ANY(p_order_ids) ORDER BY id FOR UPDATE
  LOOP
    IF v_uid IS NULL THEN
      v_uid := v_order.user_id;
    ELSIF v_uid <> v_order.user_id THEN
      RAISE EXCEPTION 'ORDERS_NOT_SAME_CUSTOMER';
    END IF;

    IF v_order.status = 'cancelled' THEN
      RAISE EXCEPTION 'ORDER_CANCELLED:%', v_order.order_number;
    END IF;

    IF v_order.payment_status = 'paid' THEN
      v_results := v_results || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number,
        'already_paid', true, 'amount', v_order.total);
      CONTINUE;
    END IF;

    v_total := v_total + v_order.total;
  END LOOP;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('success', true, 'reference', p_reference,
                              'amount', 0, 'orders', v_results, 'idempotent', true);
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = v_uid AND wallet_type = 'customer'
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;
  IF COALESCE(v_wallet.is_disabled, false) THEN
    RAISE EXCEPTION 'WALLET_DISABLED';
  END IF;

  v_balance := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_balance, 0) ELSE COALESCE(v_wallet.balance, 0) END;

  -- Already-posted debits for these orders do not need the balance again.
  SELECT COALESCE(SUM(wt.amount), 0) INTO v_balance
  FROM public.wallet_transactions wt
  WHERE wt.wallet_id = v_wallet.id
    AND wt.order_id = ANY(p_order_ids)
    AND wt.category = 'wallet_payment';

  v_total := v_total - v_balance;
  v_balance := CASE WHEN v_is_test THEN COALESCE(v_wallet.test_balance, 0) ELSE COALESCE(v_wallet.balance, 0) END;

  IF v_total > 0 AND v_balance < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: wallet % needs %', v_balance, v_total;
  END IF;

  -- One debit per order, deterministic reference => retries never double debit.
  FOR v_order IN
    SELECT * FROM public.orders WHERE id = ANY(p_order_ids) AND payment_status <> 'paid' ORDER BY id
  LOOP
    v_ref := 'WP-' || v_order.id::text;

    SELECT EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE wallet_id = v_wallet.id AND reference = v_ref
    ) INTO v_already;

    IF NOT v_already THEN
      PERFORM public.post_wallet_entry(
        v_wallet.id, 'customer', 'debit', 'wallet_payment', v_order.total, v_ref,
        p_environment, v_order.id,
        'Payment for order #' || v_order.order_number,
        jsonb_build_object('source', 'pay_orders_with_wallet', 'batch', p_reference));
    END IF;

    UPDATE public.orders
    SET payment_status = 'paid',
        payment_reference = p_reference,
        payment_method = 'wallet',
        status = CASE WHEN status = 'pending' THEN 'confirmed'::order_status ELSE status END
    WHERE id = v_order.id;

    v_results := v_results || jsonb_build_object(
      'order_id', v_order.id, 'order_number', v_order.order_number,
      'already_paid', false, 'amount', v_order.total, 'reference', v_ref);
  END LOOP;

  SELECT CASE WHEN v_is_test THEN COALESCE(test_balance, 0) ELSE COALESCE(balance, 0) END
    INTO v_balance FROM public.wallets WHERE id = v_wallet.id;

  RETURN jsonb_build_object('success', true, 'reference', p_reference,
                            'amount', v_total, 'new_balance', v_balance, 'orders', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.pay_orders_with_wallet(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_orders_with_wallet(uuid[], text, text) TO service_role;