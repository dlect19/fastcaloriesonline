-- Resolve a cart add-on to its authoritative addon_items row.
-- Accepts either addon_item_id (new carts) or group_name/item_name (carts that
-- were already in localStorage before ids were carried through).
CREATE OR REPLACE FUNCTION public.resolve_addon_item_id(p_product_id uuid, p_addon jsonb)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT ai.id
  FROM public.addon_items ai
  LEFT JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
  WHERE ai.is_available
    AND (
      (NULLIF(p_addon ->> 'addon_item_id', '') IS NOT NULL
        AND ai.id = (p_addon ->> 'addon_item_id')::uuid)
      OR (
        NULLIF(p_addon ->> 'addon_item_id', '') IS NULL
        AND NULLIF(p_addon ->> 'item_name', '') IS NOT NULL
        AND lower(ai.name) = lower(p_addon ->> 'item_name')
        AND (NULLIF(p_addon ->> 'group_name', '') IS NULL
             OR lower(COALESCE(ag.name, '')) = lower(p_addon ->> 'group_name'))
        AND (
          p_product_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.product_addon_groups pag
            WHERE pag.product_id = p_product_id AND pag.addon_group_id = ai.addon_group_id
          )
        )
      )
    )
  ORDER BY (NULLIF(p_addon ->> 'addon_item_id', '') IS NOT NULL) DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_addon_item_id(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.price_checkout_line(
  p_vendor_id uuid,
  p_outlet_id uuid,
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_product public.products;
  v_combo public.combos;
  v_qty numeric := COALESCE((p_item ->> 'quantity')::numeric, 0);
  v_purchase_unit text := CASE WHEN (p_item ->> 'purchase_unit') = 'sachet' THEN 'sachet' ELSE 'pack' END;
  v_unit numeric;
  v_addon_sum numeric := 0;
  v_expected integer := 0;
  v_resolved integer := 0;
  v_multiplier numeric := 1;
  v_product_id uuid := NULLIF(p_item ->> 'product_id', '')::uuid;
BEGIN
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  SELECT count(*) INTO v_expected
  FROM jsonb_array_elements(COALESCE(p_item -> 'addons', '[]'::jsonb)) a
  WHERE COALESCE(NULLIF(a ->> 'addon_item_id', ''), NULLIF(a ->> 'item_name', '')) IS NOT NULL;

  SELECT COALESCE(SUM(ai.additional_price * COALESCE((a ->> 'quantity')::numeric, 1)), 0), count(ai.id)
    INTO v_addon_sum, v_resolved
  FROM jsonb_array_elements(COALESCE(p_item -> 'addons', '[]'::jsonb)) a
  LEFT JOIN public.addon_items ai
    ON ai.id = public.resolve_addon_item_id(v_product_id, a)
  WHERE COALESCE(NULLIF(a ->> 'addon_item_id', ''), NULLIF(a ->> 'item_name', '')) IS NOT NULL;

  IF v_resolved <> v_expected THEN
    RAISE EXCEPTION 'INVALID_OPTION:%', COALESCE(p_item ->> 'product_name', 'item');
  END IF;

  IF NULLIF(p_item ->> 'combo_id', '') IS NOT NULL THEN
    SELECT * INTO v_combo FROM public.combos WHERE id = (p_item ->> 'combo_id')::uuid;
    IF v_combo.id IS NULL OR NOT v_combo.is_available OR v_combo.vendor_id <> p_vendor_id THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', COALESCE(p_item ->> 'product_name', 'item');
    END IF;
    v_unit := v_combo.combo_price;
  ELSE
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
    IF v_product.id IS NULL OR v_product.vendor_id <> p_vendor_id THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', COALESCE(p_item ->> 'product_name', 'item');
    END IF;
    IF NOT public.product_effective_available(v_product.id, p_outlet_id) THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', v_product.name;
    END IF;

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
    ELSIF NULLIF(p_item ->> 'portion_id', '') IS NOT NULL THEN
      SELECT price INTO v_unit FROM public.product_portions
      WHERE id = (p_item ->> 'portion_id')::uuid AND product_id = v_product.id AND is_available;
      IF v_unit IS NULL THEN
        RAISE EXCEPTION 'INVALID_OPTION:%', v_product.name;
      END IF;
    ELSE
      v_unit := COALESCE(v_product.discount_price, v_product.price);
      IF COALESCE(v_product.allows_sachet, false) AND COALESCE(v_product.sachets_per_pack, 0) > 0 THEN
        v_multiplier := v_product.sachets_per_pack;
      END IF;
    END IF;
  END IF;

  v_unit := COALESCE(v_unit, 0) + COALESCE(v_addon_sum, 0);

  RETURN jsonb_build_object(
    'unit_price', v_unit,
    'quantity', v_qty,
    'line_total', ROUND(v_unit * v_qty, 2),
    'unit_multiplier', v_multiplier,
    'purchase_unit', v_purchase_unit,
    'addon_total', v_addon_sum
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.price_checkout_line(uuid, uuid, jsonb) TO authenticated, service_role;