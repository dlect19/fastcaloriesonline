-- Rebuild create_customer_order so stored add-on lines resolve through
-- resolve_addon_item_id (id when the cart carries one, otherwise group/item name).
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
  v_priced jsonb;
  v_qty numeric;
  v_unit numeric;
  v_charged numeric := 0;
  v_menu numeric := 0;
  v_free_value numeric := 0;
  v_calories integer := 0;
  v_packaging numeric := GREATEST(0, COALESCE((p_payload ->> 'packaging_fee')::numeric, 0));
  v_extra_pkg numeric := GREATEST(0, COALESCE((p_payload ->> 'extra_package_fee')::numeric, 0));
  v_package_count integer := GREATEST(1, COALESCE((p_payload ->> 'package_count')::integer, 1));
  v_requested_discount numeric := GREATEST(0, COALESCE((p_payload ->> 'discount')::numeric, 0));
  v_promo_code text := NULLIF(p_payload ->> 'promo_code', '');
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
  v_items jsonb := COALESCE(p_payload -> 'items', '[]'::jsonb);
  v_free_promo uuid := NULLIF(p_payload ->> 'free_meal_promo_id', '')::uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'VENDOR_REQUIRED'; END IF;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  IF v_delivery_type NOT IN ('delivery', 'self_pickup') THEN RAISE EXCEPTION 'INVALID_DELIVERY_TYPE'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text || '|' || COALESCE(v_fingerprint, v_attempt_key, 'none')));

  IF v_attempt_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.orders
    WHERE checkout_attempt_key = v_attempt_key AND user_id = v_uid LIMIT 1;
  END IF;

  IF v_existing.id IS NULL AND v_fingerprint IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.orders
    WHERE user_id = v_uid AND checkout_fingerprint = v_fingerprint
      AND status <> 'cancelled' AND payment_status <> 'paid'
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id, 'order_number', v_existing.order_number, 'resumed', true,
      'total', v_existing.total, 'delivery_fee', v_existing.delivery_fee,
      'service_fee', v_existing.service_fee, 'discount', v_existing.discount,
      'payment_status', v_existing.payment_status);
  END IF;

  SELECT category::text INTO v_category FROM public.vendors WHERE id = v_vendor_id;
  IF v_category IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;

  IF v_outlet_id IS NOT NULL THEN
    PERFORM 1 FROM public.vendor_outlets
    WHERE id = v_outlet_id AND vendor_id = v_vendor_id AND is_active AND is_approved;
    IF NOT FOUND THEN RAISE EXCEPTION 'OUTLET_UNAVAILABLE'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_priced := public.price_checkout_line(v_vendor_id, v_outlet_id, v_item);
    v_qty := (v_priced ->> 'quantity')::numeric;
    v_unit := (v_priced ->> 'unit_price')::numeric;
    v_is_free := COALESCE((v_item ->> 'is_free_meal')::boolean, false);

    v_menu := v_menu + v_unit * v_qty;
    IF v_is_free THEN
      v_free_value := v_free_value + v_unit * v_qty;
    ELSE
      v_charged := v_charged + v_unit * v_qty;
    END IF;
    v_calories := v_calories + COALESCE((v_item ->> 'calories')::integer, 0);
  END LOOP;

  v_extra_pkg := LEAST(v_extra_pkg, GREATEST(0, v_package_count - 1) * 1000);
  v_packaging := LEAST(v_packaging, GREATEST(2000, v_charged * 0.5));
  v_discount := LEAST(v_requested_discount,
                      public.max_allowed_order_discount(v_uid, v_menu, v_promo_code),
                      v_charged);
  v_service_fee := public.compute_service_fee(v_charged, v_delivery_type, v_category);

  IF v_delivery_type = 'delivery' THEN
    IF v_quote_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_QUOTE_REQUIRED'; END IF;
    SELECT * INTO v_quote FROM public.delivery_quotes
    WHERE id = v_quote_id AND user_id = v_uid AND vendor_id = v_vendor_id
      AND consumed_order_id IS NULL AND expires_at > now();
    IF v_quote.id IS NULL THEN RAISE EXCEPTION 'DELIVERY_QUOTE_STALE'; END IF;
    IF v_quote.checkout_fingerprint IS NOT NULL AND v_fingerprint IS NOT NULL
       AND v_quote.checkout_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'DELIVERY_QUOTE_CHECKOUT_MISMATCH';
    END IF;
    v_delivery_fee := v_quote.delivery_fee + v_extra_pkg;
  ELSE
    v_delivery_fee := 0;
    v_extra_pkg := 0;
  END IF;

  v_total := ROUND(v_charged + v_packaging + v_delivery_fee + v_service_fee - v_discount, 2);

  IF v_expected_total IS NOT NULL AND v_total > v_expected_total + 1 THEN
    RAISE EXCEPTION 'PRICING_CHANGED: shown % server %', v_expected_total, v_total;
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
    v_menu, v_charged + v_packaging - v_discount, v_packaging, v_delivery_fee,
    v_service_fee, v_discount, v_total,
    v_calories, v_promo_code, v_delivery_type, NULLIF(p_payload ->> 'delivery_address_id', '')::uuid,
    p_payload ->> 'delivery_address_text', NULLIF(p_payload ->> 'delivery_instructions', ''),
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

  v_idx := 0;
  FOR v_pkg IN SELECT * FROM jsonb_array_elements(
                 CASE WHEN jsonb_array_length(COALESCE(p_payload -> 'packages', '[]'::jsonb)) > 0
                      THEN p_payload -> 'packages' ELSE '[{}]'::jsonb END)
  LOOP
    INSERT INTO public.order_packages (order_id, recipient_name, note, sort_order)
    VALUES (v_order.id, COALESCE(NULLIF(v_pkg ->> 'recipient_name', ''), 'Package ' || (v_idx + 1)),
            NULLIF(v_pkg ->> 'note', ''), v_idx)
    RETURNING id INTO v_pkg_id;
    v_pkg_ids := v_pkg_ids || v_pkg_id;
    v_idx := v_idx + 1;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_priced := public.price_checkout_line(v_vendor_id, v_outlet_id, v_item);
    v_qty := (v_priced ->> 'quantity')::numeric;
    v_unit := (v_priced ->> 'unit_price')::numeric;
    v_is_free := COALESCE((v_item ->> 'is_free_meal')::boolean, false);
    v_idx := COALESCE((v_item ->> 'package_index')::integer, 0);

    INSERT INTO public.order_items (
      order_id, package_id, product_id, product_name, quantity,
      unit_price, total_price, original_unit_price, is_free_meal_item, free_qty,
      calories, special_instructions, purchase_unit, unit_multiplier,
      portion_label, portion_size, portion_unit
    ) VALUES (
      v_order.id,
      CASE WHEN v_idx + 1 <= COALESCE(array_length(v_pkg_ids, 1), 0) THEN v_pkg_ids[v_idx + 1] ELSE v_pkg_ids[1] END,
      NULLIF(v_item ->> 'product_id', '')::uuid,
      COALESCE(v_item ->> 'product_name', 'Item'),
      v_qty, v_unit, ROUND(v_unit * v_qty, 2),
      CASE WHEN v_is_free THEN v_unit END,
      v_is_free,
      CASE WHEN v_is_free THEN COALESCE((v_item ->> 'free_qty')::integer, v_qty::integer) END,
      COALESCE((v_item ->> 'calories')::integer, 0),
      NULLIF(v_item ->> 'special_instructions', ''),
      (v_priced ->> 'purchase_unit'),
      (v_priced ->> 'unit_multiplier')::numeric,
      NULLIF(v_item ->> 'portion_label', ''),
      NULLIF(v_item ->> 'portion_size', '')::numeric,
      NULLIF(v_item ->> 'portion_unit', '')
    )
    RETURNING id INTO v_item_id;

    FOR v_addon IN SELECT * FROM jsonb_array_elements(COALESCE(v_item -> 'addons', '[]'::jsonb))
    LOOP
      IF COALESCE(NULLIF(v_addon ->> 'addon_item_id', ''), NULLIF(v_addon ->> 'item_name', '')) IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.order_item_addons (
        order_item_id, addon_group_name, addon_item_name, additional_price, calories, image_url
      )
      SELECT v_item_id, COALESCE(NULLIF(v_addon ->> 'group_name', ''), ag.name, 'Options'),
             ai.name, COALESCE(ai.additional_price, 0), COALESCE(ai.calories, 0),
             NULLIF(v_addon ->> 'image_url', '')
      FROM public.addon_items ai
      LEFT JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
      WHERE ai.id = public.resolve_addon_item_id(NULLIF(v_item ->> 'product_id', '')::uuid, v_addon);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number, 'resumed', false,
    'menu_subtotal', v_order.menu_subtotal, 'subtotal', v_order.subtotal,
    'packaging_fee', v_order.packaging_fee, 'delivery_fee', v_order.delivery_fee,
    'service_fee', v_order.service_fee, 'discount', v_order.discount,
    'total', v_order.total, 'payment_status', v_order.payment_status);
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(jsonb) TO authenticated, service_role;