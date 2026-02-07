-- Add image_url column to order_item_addons to store addon images at order time
ALTER TABLE public.order_item_addons ADD COLUMN image_url text;