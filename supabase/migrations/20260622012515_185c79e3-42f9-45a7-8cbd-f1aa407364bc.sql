ALTER TABLE public.assisted_orders DROP CONSTRAINT IF EXISTS assisted_orders_payment_method_check;
ALTER TABLE public.assisted_orders ADD CONSTRAINT assisted_orders_payment_method_check CHECK (payment_method = ANY (ARRAY['paystack_link'::text, 'bank_transfer'::text, 'wallet'::text, 'cash'::text, 'shadow_credit'::text, 'combined'::text]));

-- Backfill the missing assisted_orders row for the recent shadow_credit order that didn't get one
INSERT INTO public.assisted_orders (order_id, customer_channel, payment_method, payment_status, created_by, last_modified_by)
SELECT o.id, 'phone', 'shadow_credit', 'awaiting', o.assisted_created_by, o.assisted_created_by
FROM public.orders o
LEFT JOIN public.assisted_orders ao ON ao.order_id = o.id
WHERE o.channel = 'assisted' AND ao.id IS NULL AND o.assisted_created_by IS NOT NULL;