UPDATE public.shadow_customer_credits
SET status = 'pending', order_id = NULL,
    notes = 'Restored after assisted order #FC-260622-8987 was cancelled (backfill)',
    updated_at = now()
WHERE id = '4517d94b-790f-4825-a109-1e49591b506f';