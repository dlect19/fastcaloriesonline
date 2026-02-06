
-- Add-on groups linked to products
CREATE TABLE public.addon_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single', 'multiple')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  min_selections INTEGER DEFAULT 0,
  max_selections INTEGER DEFAULT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add-on items within groups
CREATE TABLE public.addon_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  addon_group_id UUID NOT NULL REFERENCES public.addon_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  additional_price NUMERIC NOT NULL DEFAULT 0,
  calories INTEGER DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Store selected add-ons per order item (denormalized for history)
CREATE TABLE public.order_item_addons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  addon_group_name TEXT NOT NULL,
  addon_item_name TEXT NOT NULL,
  additional_price NUMERIC NOT NULL DEFAULT 0,
  calories INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.addon_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_addons ENABLE ROW LEVEL SECURITY;

-- RLS: addon_groups
CREATE POLICY "Anyone can view addon groups" ON public.addon_groups
  FOR SELECT USING (true);

CREATE POLICY "Vendor owners can manage addon groups" ON public.addon_groups
  FOR ALL USING (
    public.owns_vendor(auth.uid(), vendor_id)
    OR public.get_vendor_staff_role(auth.uid(), vendor_id) IN ('owner', 'manager')
  );

-- RLS: addon_items
CREATE POLICY "Anyone can view addon items" ON public.addon_items
  FOR SELECT USING (true);

CREATE POLICY "Vendor owners can manage addon items" ON public.addon_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.addon_groups ag
      WHERE ag.id = addon_group_id
      AND (
        public.owns_vendor(auth.uid(), ag.vendor_id)
        OR public.get_vendor_staff_role(auth.uid(), ag.vendor_id) IN ('owner', 'manager')
      )
    )
  );

-- RLS: order_item_addons
CREATE POLICY "Users can view own order addons" ON public.order_item_addons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_id
      AND (o.user_id = auth.uid() OR public.owns_vendor(auth.uid(), o.vendor_id)
        OR public.get_vendor_staff_role(auth.uid(), o.vendor_id) IS NOT NULL
        OR public.get_admin_staff_role(auth.uid()) IS NOT NULL)
    )
  );

CREATE POLICY "Authenticated users can insert order addons" ON public.order_item_addons
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_addon_groups_product ON public.addon_groups(product_id);
CREATE INDEX idx_addon_groups_vendor ON public.addon_groups(vendor_id);
CREATE INDEX idx_addon_items_group ON public.addon_items(addon_group_id);
CREATE INDEX idx_order_item_addons_item ON public.order_item_addons(order_item_id);

-- Trigger for updated_at on addon_groups
CREATE TRIGGER update_addon_groups_updated_at
  BEFORE UPDATE ON public.addon_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
