
-- Free meal promos table: admin configures which vendor meals are free
CREATE TABLE public.free_meal_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES public.vendor_outlets(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_image_url TEXT,
  vendor_name TEXT NOT NULL,
  meal_value NUMERIC NOT NULL, -- e.g. 1500, 2500, 3500
  order_threshold NUMERIC NOT NULL, -- minimum single order amount to unlock
  promo_period_days INTEGER NOT NULL DEFAULT 7, -- custom period set by admin
  max_redemptions_per_period INTEGER NOT NULL DEFAULT 1, -- how many times per period
  is_active BOOLEAN NOT NULL DEFAULT true,
  banner_image_url TEXT, -- flash news banner image
  banner_text TEXT DEFAULT 'You have a free meal today!',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track customer redemptions
CREATE TABLE public.free_meal_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  promo_id UUID NOT NULL REFERENCES public.free_meal_promos(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  qualifying_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL, -- the order that met threshold
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meal_value NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'redeemed' -- redeemed, cancelled
);

-- Track customer progress toward threshold
CREATE TABLE public.free_meal_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  promo_id UUID NOT NULL REFERENCES public.free_meal_promos(id) ON DELETE CASCADE,
  highest_order_amount NUMERIC NOT NULL DEFAULT 0, -- highest single order amount in period
  qualifying_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_eligible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, promo_id)
);

-- Enable RLS
ALTER TABLE public.free_meal_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_meal_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_meal_progress ENABLE ROW LEVEL SECURITY;

-- RLS policies for free_meal_promos (public read for active, admin write)
CREATE POLICY "Anyone can view active free meal promos"
  ON public.free_meal_promos FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage free meal promos"
  ON public.free_meal_promos FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for free_meal_redemptions
CREATE POLICY "Users can view their own redemptions"
  ON public.free_meal_redemptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own redemptions"
  ON public.free_meal_redemptions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all redemptions"
  ON public.free_meal_redemptions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for free_meal_progress
CREATE POLICY "Users can view their own progress"
  ON public.free_meal_progress FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own progress"
  ON public.free_meal_progress FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all progress"
  ON public.free_meal_progress FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Index for performance
CREATE INDEX idx_free_meal_promos_active ON public.free_meal_promos(is_active) WHERE is_active = true;
CREATE INDEX idx_free_meal_redemptions_user ON public.free_meal_redemptions(user_id, promo_id);
CREATE INDEX idx_free_meal_progress_user ON public.free_meal_progress(user_id, promo_id);
