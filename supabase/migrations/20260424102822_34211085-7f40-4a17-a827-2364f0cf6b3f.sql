-- Backfill outlet_id for any orders that were created without one,
-- using the vendor's default (or first active+approved) outlet.
-- This unblocks vendors from seeing orders that were stuck "invisible"
-- because the vendor portal filters strictly by outlet_id.
UPDATE public.orders o
SET outlet_id = vo.id
FROM (
  SELECT DISTINCT ON (vendor_id) vendor_id, id
  FROM public.vendor_outlets
  WHERE is_active = true AND is_approved = true
  ORDER BY vendor_id, is_default DESC, created_at ASC
) vo
WHERE o.outlet_id IS NULL
  AND o.vendor_id = vo.vendor_id;