ALTER TABLE public.voucher_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.voucher_orders ADD COLUMN IF NOT EXISTS guest_name TEXT;