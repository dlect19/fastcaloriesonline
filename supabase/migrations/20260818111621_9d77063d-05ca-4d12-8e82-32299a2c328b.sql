CREATE TABLE public.vendor_whatsapp_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES public.vendor_outlets(id) ON DELETE CASCADE,
  phone text,
  phone_verified boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  alert_new_order boolean NOT NULL DEFAULT true,
  alert_unattended boolean NOT NULL DEFAULT true,
  alert_daily_summary boolean NOT NULL DEFAULT true,
  last_alert_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_whatsapp_alerts TO authenticated;
GRANT ALL ON public.vendor_whatsapp_alerts TO service_role;

ALTER TABLE public.vendor_whatsapp_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor team can view their alert settings"
ON public.vendor_whatsapp_alerts FOR SELECT TO authenticated
USING (public.owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Vendor team can create their alert settings"
ON public.vendor_whatsapp_alerts FOR INSERT TO authenticated
WITH CHECK (public.owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Vendor team can update their alert settings"
ON public.vendor_whatsapp_alerts FOR UPDATE TO authenticated
USING (public.owns_vendor(auth.uid(), vendor_id))
WITH CHECK (public.owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Admins can manage vendor alert settings"
ON public.vendor_whatsapp_alerts FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_vendor_whatsapp_alerts_updated_at
BEFORE UPDATE ON public.vendor_whatsapp_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vendor_wa_new_order_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_wa_unattended_alerted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_vendor_wa_new_order
  ON public.orders (created_at)
  WHERE vendor_wa_new_order_alerted_at IS NULL;