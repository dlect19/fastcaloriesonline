-- Server-authoritative delivery pricing: persist the trusted inputs and the
-- pricing source on every order so payment functions can revalidate them.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_latitude numeric,
  ADD COLUMN IF NOT EXISTS delivery_longitude numeric,
  ADD COLUMN IF NOT EXISTS delivery_distance_km numeric,
  ADD COLUMN IF NOT EXISTS delivery_pricing_source text,
  ADD COLUMN IF NOT EXISTS delivery_pricing_meta jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_pricing_source
  ON public.orders (delivery_pricing_source, created_at DESC)
  WHERE delivery_pricing_source IS NOT NULL;

-- Single effective-availability rule shared by every ordering channel.
-- Considers: hidden flag, branch override (when a branch is given),
-- global availability, and the existing track_stock/stock_quantity model.
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
      WHEN _outlet_id IS NOT NULL AND o.is_available IS NOT NULL THEN o.is_available
      ELSE COALESCE(p.is_available, false)
    END
    FROM public.products p
    LEFT JOIN public.outlet_product_overrides o
      ON o.product_id = p.id AND o.outlet_id = _outlet_id
    WHERE p.id = _product_id
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.product_effective_available(uuid, uuid) TO anon, authenticated, service_role;
