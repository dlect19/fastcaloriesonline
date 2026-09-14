-- Phase A: shared Product Ordering Rules Engine (additive, back-compatible).
-- Existing products stay orderable: every new column defaults to today's behaviour.

-- 1. Widen the two classification vocabularies (values only, no data change).
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_fulfillment_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_fulfillment_type_check
  CHECK (fulfillment_type IS NULL OR fulfillment_type = ANY (ARRAY['instant','preorder','both']));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_medicine_classification_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_medicine_classification_check
  CHECK (medicine_classification IS NULL OR medicine_classification = ANY (
    ARRAY['otc','pharmacist_review','prescription','controlled','restricted']));

-- 2. Sale unit / packaging + purchase quantity rules.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_unit text,
  ADD COLUMN IF NOT EXISTS sale_unit_label text,
  ADD COLUMN IF NOT EXISTS units_per_pack integer,
  ADD COLUMN IF NOT EXISTS allows_break_pack boolean,
  ADD COLUMN IF NOT EXISTS min_order_qty numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_order_qty numeric,
  ADD COLUMN IF NOT EXISTS qty_step numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_purchase_age integer,
  ADD COLUMN IF NOT EXISTS whatsapp_orderable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prep_time_minutes integer,
  ADD COLUMN IF NOT EXISTS preorder_lead_minutes integer,
  ADD COLUMN IF NOT EXISTS preorder_cutoff_time time,
  ADD COLUMN IF NOT EXISTS preorder_weekdays smallint[],
  ADD COLUMN IF NOT EXISTS preorder_min_qty numeric;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_qty_rules_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_qty_rules_check
  CHECK (min_order_qty > 0 AND qty_step > 0 AND (max_order_qty IS NULL OR max_order_qty >= min_order_qty));

COMMENT ON COLUMN public.products.sale_unit IS 'Configured sale unit (each/tablet/sachet/strip/pack/portion/...). NULL falls back to portion_unit/serving_unit.';
COMMENT ON COLUMN public.products.allows_break_pack IS 'NULL = derive from allows_sachet. FALSE = pack/strip may not be split.';
COMMENT ON COLUMN public.products.medicine_classification IS 'Authoritative regulated-sale rule: otc | pharmacist_review | prescription | controlled | restricted.';

-- 3. Recommended add-ons ("goes well with") — never a checkout blocker.
CREATE TABLE IF NOT EXISTS public.product_recommended_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  recommended_product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  addon_item_id uuid REFERENCES public.addon_items(id) ON DELETE CASCADE,
  label text,
  reason text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_recommended_addons_target_check
    CHECK (recommended_product_id IS NOT NULL OR addon_item_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_product_recommended_addons_product
  ON public.product_recommended_addons(product_id) WHERE is_active;

GRANT SELECT ON public.product_recommended_addons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_recommended_addons TO authenticated;
GRANT ALL ON public.product_recommended_addons TO service_role;

ALTER TABLE public.product_recommended_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view recommended addons" ON public.product_recommended_addons;
CREATE POLICY "Anyone can view recommended addons"
  ON public.product_recommended_addons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Vendors manage their recommended addons" ON public.product_recommended_addons;
CREATE POLICY "Vendors manage their recommended addons"
  ON public.product_recommended_addons FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
                 WHERE p.id = product_recommended_addons.product_id
                   AND (public.owns_vendor(auth.uid(), p.vendor_id)
                        OR public.get_vendor_staff_role(auth.uid(), p.vendor_id)
                             = ANY (ARRAY['owner'::vendor_staff_role,'manager'::vendor_staff_role])
                        OR public.has_role(auth.uid(), 'admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
                 WHERE p.id = product_recommended_addons.product_id
                   AND (public.owns_vendor(auth.uid(), p.vendor_id)
                        OR public.get_vendor_staff_role(auth.uid(), p.vendor_id)
                             = ANY (ARRAY['owner'::vendor_staff_role,'manager'::vendor_staff_role])
                        OR public.has_role(auth.uid(), 'admin'))));

-- 4. One read-only rules snapshot every channel can consume (WhatsApp, web/app,
--    assisted ordering, POS). Availability stays authoritative via
--    public.product_effective_available; a branch override can never resurrect a
--    globally disabled or hidden product.
CREATE OR REPLACE FUNCTION public.get_product_ordering_rules(
  p_product_id uuid,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products;
  v_vendor public.vendors;
  v_available boolean;
  v_groups jsonb;
  v_portions jsonb;
  v_recos jsonb;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PRODUCT_NOT_FOUND');
  END IF;

  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_product.vendor_id;

  v_available := public.product_effective_available(p_product_id, p_outlet_id);

  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'sort_order')::int), '[]'::jsonb) INTO v_groups
  FROM (
    SELECT jsonb_build_object(
             'group_id', ag.id,
             'name', ag.name,
             'is_required', ag.is_required,
             'selection_type', ag.selection_type,
             'min_selections', COALESCE(ag.min_selections, 0),
             'max_selections', ag.max_selections,
             'sort_order', COALESCE(ag.sort_order, 0),
             'items', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'addon_item_id', ai.id,
                        'name', ai.name,
                        'price', ai.additional_price,
                        'calories', ai.calories,
                        'is_available', ai.is_available
                      ) ORDER BY COALESCE(ai.sort_order, 0))
               FROM public.addon_items ai
               WHERE ai.addon_group_id = ag.id AND ai.is_available
             ), '[]'::jsonb)
           ) AS g
    FROM public.addon_groups ag
    WHERE (ag.product_id = p_product_id
           OR ag.id IN (SELECT pag.addon_group_id FROM public.product_addon_groups pag
                        WHERE pag.product_id = p_product_id))
      AND (ag.outlet_id IS NULL OR p_outlet_id IS NULL OR ag.outlet_id = p_outlet_id)
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'portion_id', pp.id,
           'label', pp.label,
           'price', pp.price,
           'portion_size', pp.portion_size,
           'unit', pp.unit,
           'calorie_multiplier', COALESCE(pp.calorie_multiplier, 1)
         ) ORDER BY COALESCE(pp.sort_order, 0)), '[]'::jsonb) INTO v_portions
  FROM public.product_portions pp
  WHERE pp.product_id = p_product_id AND pp.is_available;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'recommended_product_id', r.recommended_product_id,
           'addon_item_id', r.addon_item_id,
           'name', COALESCE(rp.name, ri.name),
           'price', COALESCE(rp.price, ri.additional_price),
           'calories', COALESCE(rp.calories, ri.calories),
           'label', r.label,
           'reason', r.reason
         ) ORDER BY r.sort_order), '[]'::jsonb) INTO v_recos
  FROM public.product_recommended_addons r
  LEFT JOIN public.products rp ON rp.id = r.recommended_product_id
  LEFT JOIN public.addon_items ri ON ri.id = r.addon_item_id
  WHERE r.product_id = p_product_id AND r.is_active;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product.id,
    'name', v_product.name,
    'vendor_id', v_product.vendor_id,
    'outlet_id', p_outlet_id,
    'vendor_category', v_vendor.category,
    'price', v_product.price,
    'discount_price', v_product.discount_price,
    'available', v_available,
    'calories', v_product.calories,
    'calories_known', (v_product.calories IS NOT NULL),
    'sale_unit', COALESCE(v_product.sale_unit, v_product.portion_unit, v_product.serving_unit),
    'sale_unit_label', COALESCE(v_product.sale_unit_label, v_product.pack_unit_label, v_product.portion_unit),
    'units_per_pack', COALESCE(v_product.units_per_pack, v_product.sachets_per_pack),
    'allows_break_pack', COALESCE(v_product.allows_break_pack, v_product.allows_sachet, false),
    'allows_fractional_qty', COALESCE(v_product.allows_fractional_qty, false),
    'sachet_price', v_product.sachet_price,
    'sachet_unit_label', v_product.sachet_unit_label,
    'min_order_qty', COALESCE(v_product.min_order_qty, 1),
    'max_order_qty', v_product.max_order_qty,
    'qty_step', COALESCE(v_product.qty_step, 1),
    'min_purchase_age', v_product.min_purchase_age,
    'whatsapp_orderable', COALESCE(v_product.whatsapp_orderable, true),
    'medicine_classification', v_product.medicine_classification,
    'requires_prescription', COALESCE(v_product.requires_prescription, false),
    'is_pharmacy', (v_vendor.category = 'pharmacy'::vendor_category),
    'order_mode', COALESCE(v_product.fulfillment_type, 'instant'),
    'preorder_lead_days', v_product.preorder_lead_days,
    'preorder_lead_minutes', v_product.preorder_lead_minutes,
    'prep_time_minutes', v_product.prep_time_minutes,
    'preorder_cutoff_time', v_product.preorder_cutoff_time,
    'preorder_weekdays', v_product.preorder_weekdays,
    'preorder_min_qty', v_product.preorder_min_qty,
    'option_groups', v_groups,
    'portions', v_portions,
    'recommended_addons', v_recos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_ordering_rules(uuid, uuid) TO anon, authenticated, service_role;