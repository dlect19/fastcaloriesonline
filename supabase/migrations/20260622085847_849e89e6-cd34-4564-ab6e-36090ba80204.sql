-- Backfill missing shadow credit for the assisted substitute on order FC-260622-6522
-- Order total went from 12,040 -> 2,140 via substitute, but the shadow credit
-- logic in vendor-refund-item was added AFTER the substitute ran, so no credit
-- was recorded for the customer (08127917744). Insert it now.

INSERT INTO public.shadow_customer_credits (
  phone, customer_name, amount, environment, status, source,
  order_id, reason, notes
)
SELECT
  o.receiver_phone,
  o.receiver_name,
  9900.00,
  COALESCE((SELECT value FROM public.platform_settings WHERE key='platform_environment'), 'development'),
  'pending',
  'assisted_refund',
  o.id,
  'Substitute partial refund (backfill)',
  'Jollof rice (7) replaced with eba (3) on assisted order #' || o.order_number || ' — credit issued retroactively after fix.'
FROM public.orders o
WHERE o.id = '3d1abef1-34e6-487f-a972-998b4f5897ee'
  AND NOT EXISTS (
    SELECT 1 FROM public.shadow_customer_credits s
    WHERE s.order_id = o.id AND s.source = 'assisted_refund'
  );