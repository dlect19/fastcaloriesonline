
ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS variant_id,
  DROP COLUMN IF EXISTS variant_label,
  DROP COLUMN IF EXISTS variant_price;

ALTER TABLE public.whatsapp_orders
  DROP COLUMN IF EXISTS variant_id,
  DROP COLUMN IF EXISTS variant_label,
  DROP COLUMN IF EXISTS variant_price;

DROP TABLE IF EXISTS public.product_variants;
