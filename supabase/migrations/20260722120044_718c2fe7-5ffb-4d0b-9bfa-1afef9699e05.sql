
CREATE TABLE public.voucher_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  validity_days integer NOT NULL CHECK (validity_days > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voucher_categories_vendor ON public.voucher_categories(vendor_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_categories TO authenticated;
GRANT ALL ON public.voucher_categories TO service_role;
ALTER TABLE public.voucher_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors manage own voucher categories" ON public.voucher_categories
  FOR ALL TO authenticated USING (public.owns_vendor(auth.uid(), vendor_id)) WITH CHECK (public.owns_vendor(auth.uid(), vendor_id));
CREATE POLICY "Signed-in can view active categories" ON public.voucher_categories
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins manage all voucher categories" ON public.voucher_categories
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_voucher_categories_updated BEFORE UPDATE ON public.voucher_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.voucher_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.voucher_categories(id) ON DELETE CASCADE,
  code text NOT NULL,
  value numeric(12,2) NOT NULL CHECK (value >= 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','expired')),
  sold_at timestamptz,
  order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_id, code)
);
CREATE INDEX idx_voucher_codes_cat_status ON public.voucher_codes(category_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_codes TO authenticated;
GRANT ALL ON public.voucher_codes TO service_role;
ALTER TABLE public.voucher_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors manage own voucher codes" ON public.voucher_codes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.id = category_id AND public.owns_vendor(auth.uid(), c.vendor_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.id = category_id AND public.owns_vendor(auth.uid(), c.vendor_id)));
CREATE POLICY "Admins manage voucher codes" ON public.voucher_codes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.vendor_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL UNIQUE REFERENCES public.vendors(id) ON DELETE CASCADE,
  logo_url text,
  background_color text DEFAULT '#0F172A',
  background_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_templates TO authenticated;
GRANT ALL ON public.vendor_templates TO service_role;
ALTER TABLE public.vendor_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors manage own template" ON public.vendor_templates
  FOR ALL TO authenticated USING (public.owns_vendor(auth.uid(), vendor_id)) WITH CHECK (public.owns_vendor(auth.uid(), vendor_id));
CREATE POLICY "Signed-in view templates" ON public.vendor_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage templates" ON public.vendor_templates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_vendor_templates_updated BEFORE UPDATE ON public.vendor_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.voucher_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES public.voucher_categories(id) ON DELETE RESTRICT,
  code_id uuid NOT NULL REFERENCES public.voucher_codes(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  expiry_date timestamptz NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  rendered_image_url text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voucher_orders_buyer ON public.voucher_orders(buyer_user_id);
CREATE INDEX idx_voucher_orders_vendor ON public.voucher_orders(vendor_id);
CREATE INDEX idx_voucher_orders_category ON public.voucher_orders(category_id);
GRANT SELECT, INSERT, UPDATE ON public.voucher_orders TO authenticated;
GRANT ALL ON public.voucher_orders TO service_role;
ALTER TABLE public.voucher_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyer reads own voucher orders" ON public.voucher_orders
  FOR SELECT TO authenticated USING (buyer_user_id = auth.uid());
CREATE POLICY "Buyer updates own voucher orders" ON public.voucher_orders
  FOR UPDATE TO authenticated USING (buyer_user_id = auth.uid()) WITH CHECK (buyer_user_id = auth.uid());
CREATE POLICY "Vendors read own voucher orders" ON public.voucher_orders
  FOR SELECT TO authenticated USING (public.owns_vendor(auth.uid(), vendor_id));
CREATE POLICY "Admins manage all voucher orders" ON public.voucher_orders
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.vendor_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL UNIQUE REFERENCES public.vendors(id) ON DELETE CASCADE,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vendor_wallets TO authenticated;
GRANT ALL ON public.vendor_wallets TO service_role;
ALTER TABLE public.vendor_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor reads own wallet" ON public.vendor_wallets
  FOR SELECT TO authenticated USING (public.owns_vendor(auth.uid(), vendor_id));
CREATE POLICY "Admins read all wallets" ON public.vendor_wallets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.vendor_commission_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL UNIQUE REFERENCES public.vendors(id) ON DELETE CASCADE,
  percentage numeric(5,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vendor_commission_rates TO authenticated;
GRANT ALL ON public.vendor_commission_rates TO service_role;
ALTER TABLE public.vendor_commission_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor reads own commission rate" ON public.vendor_commission_rates
  FOR SELECT TO authenticated USING (public.owns_vendor(auth.uid(), vendor_id));
CREATE POLICY "Admins manage commission rates" ON public.vendor_commission_rates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.platform_settings(key, value)
VALUES ('voucher_hub_default_commission_pct', '10')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_vendor_voucher_commission(_vendor_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT percentage FROM public.vendor_commission_rates WHERE vendor_id = _vendor_id AND percentage IS NOT NULL),
    NULLIF((SELECT value FROM public.platform_settings WHERE key = 'voucher_hub_default_commission_pct'),'')::numeric,
    10
  );
$$;
