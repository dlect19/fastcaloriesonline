
-- Global cuisine categories with continent → sub-category hierarchy
CREATE TABLE public.cuisine_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.cuisine_categories(id) ON DELETE CASCADE,
  icon TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add cuisine_category_id to products
ALTER TABLE public.products ADD COLUMN cuisine_category_id UUID REFERENCES public.cuisine_categories(id) ON DELETE SET NULL;

-- RLS: readable by everyone, writable by admins
ALTER TABLE public.cuisine_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cuisine categories"
  ON public.cuisine_categories FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admins can manage cuisine categories"
  ON public.cuisine_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
