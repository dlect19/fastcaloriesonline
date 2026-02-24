
-- Per-outlet product availability overrides
CREATE TABLE public.outlet_product_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  outlet_id UUID NOT NULL REFERENCES public.vendor_outlets(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(outlet_id, product_id)
);

-- Enable RLS
ALTER TABLE public.outlet_product_overrides ENABLE ROW LEVEL SECURITY;

-- Vendors can read their own outlet overrides
CREATE POLICY "Vendors can view own outlet overrides"
ON public.outlet_product_overrides FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.vendor_outlets vo
    JOIN public.vendors v ON v.id = vo.vendor_id
    WHERE vo.id = outlet_product_overrides.outlet_id
    AND (v.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
    ))
  )
);

-- Vendors can manage their own outlet overrides
CREATE POLICY "Vendors can manage own outlet overrides"
ON public.outlet_product_overrides FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.vendor_outlets vo
    JOIN public.vendors v ON v.id = vo.vendor_id
    WHERE vo.id = outlet_product_overrides.outlet_id
    AND (v.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
    ))
  )
);

-- Public read for customers browsing menus
CREATE POLICY "Public can read outlet overrides"
ON public.outlet_product_overrides FOR SELECT
USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.outlet_product_overrides;
