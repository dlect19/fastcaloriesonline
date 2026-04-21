-- Add vendor-wide in-store (POS) price override on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS in_store_price NUMERIC(12,2) NULL;

-- Add per-outlet in-store price override
ALTER TABLE public.outlet_product_overrides
  ADD COLUMN IF NOT EXISTS in_store_price NUMERIC(12,2) NULL;

-- Add POS pricing mode + global discount % on each outlet
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='vendor_outlets' AND column_name='pos_pricing_mode') THEN
    ALTER TABLE public.vendor_outlets
      ADD COLUMN pos_pricing_mode TEXT NOT NULL DEFAULT 'same'
      CHECK (pos_pricing_mode IN ('same','global_discount','per_item'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='vendor_outlets' AND column_name='pos_global_discount_pct') THEN
    ALTER TABLE public.vendor_outlets
      ADD COLUMN pos_global_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0
      CHECK (pos_global_discount_pct >= 0 AND pos_global_discount_pct <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.products.in_store_price IS 'Optional vendor-wide in-store (POS) price. If set, used in POS instead of online price.';
COMMENT ON COLUMN public.outlet_product_overrides.in_store_price IS 'Optional per-outlet in-store (POS) price override. Takes precedence over products.in_store_price for that outlet.';
COMMENT ON COLUMN public.vendor_outlets.pos_pricing_mode IS 'How POS computes prices: same = identical to online; global_discount = apply pos_global_discount_pct; per_item = use in_store_price overrides where set, else online price.';