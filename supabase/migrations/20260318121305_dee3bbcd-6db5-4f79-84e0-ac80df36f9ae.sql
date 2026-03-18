
-- Create table to store multiple items in a free meal promo (combo-style)
CREATE TABLE public.free_meal_promo_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES public.free_meal_promos(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  takeaway_pack_id UUID REFERENCES public.takeaway_packs(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.free_meal_promo_items ENABLE ROW LEVEL SECURITY;

-- Public read access (customers need to see what's in the free meal)
CREATE POLICY "Anyone can view free meal promo items"
  ON public.free_meal_promo_items FOR SELECT
  USING (true);

-- Admin insert/update/delete via admin_staff check
CREATE POLICY "Admins can manage free meal promo items"
  ON public.free_meal_promo_items FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
  );

-- Index for fast lookup by promo
CREATE INDEX idx_free_meal_promo_items_promo_id ON public.free_meal_promo_items(promo_id);
