UPDATE public.order_items
SET product_name = substituted_with
WHERE substituted_with IS NOT NULL
  AND substituted_with <> ''
  AND product_name IS DISTINCT FROM substituted_with;