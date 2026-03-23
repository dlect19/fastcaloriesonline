
-- Add free meal tracking columns to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_free_meal BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS free_meal_value NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS free_meal_promo_id UUID REFERENCES public.free_meal_promos(id);

-- Add original price tracking to order_items (for free meal items where unit_price=0)
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS original_unit_price NUMERIC DEFAULT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_free_meal_item BOOLEAN DEFAULT false;
