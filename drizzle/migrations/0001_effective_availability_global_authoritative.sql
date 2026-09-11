-- Global product availability becomes authoritative: an outlet override of
-- `true` can no longer expose a globally unavailable/hidden product. An
-- override of `false` still disables a globally available product at that branch.
CREATE OR REPLACE FUNCTION public.product_effective_available(
  _product_id uuid,
  _outlet_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.is_hidden THEN false
      WHEN COALESCE(p.track_stock, false) AND COALESCE(p.stock_quantity, 0) <= 0 THEN false
      WHEN NOT COALESCE(p.is_available, false) THEN false
      WHEN _outlet_id IS NOT NULL AND o.is_available IS FALSE THEN false
      ELSE true
    END
    FROM public.products p
    LEFT JOIN public.outlet_product_overrides o
      ON o.product_id = p.id AND o.outlet_id = _outlet_id
    WHERE p.id = _product_id
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.product_effective_available(uuid, uuid) TO anon, authenticated, service_role;