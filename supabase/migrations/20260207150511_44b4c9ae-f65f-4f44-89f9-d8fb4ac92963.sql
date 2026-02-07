-- Add meal_type column to products (regular = normal menu item, addon = add-on meal)
ALTER TABLE public.products ADD COLUMN meal_type text NOT NULL DEFAULT 'regular';

-- Add linked_product_id to addon_items for syncing addon items with addon products
ALTER TABLE public.addon_items ADD COLUMN linked_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

-- Index for filtering by meal_type
CREATE INDEX idx_products_meal_type ON public.products(meal_type);

-- Index for looking up addon items by linked product
CREATE INDEX idx_addon_items_linked_product ON public.addon_items(linked_product_id) WHERE linked_product_id IS NOT NULL;