CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  content_sid TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view whatsapp templates"
ON public.whatsapp_templates FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert whatsapp templates"
ON public.whatsapp_templates FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update whatsapp templates"
ON public.whatsapp_templates FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete whatsapp templates"
ON public.whatsapp_templates FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_whatsapp_templates_updated_at
BEFORE UPDATE ON public.whatsapp_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.whatsapp_templates (template_key, content_sid, description) VALUES
  ('wa_main_menu',        '', 'Main menu — Quick Reply: Order food / Track order / My wallet'),
  ('wa_secondary_menu',   '', 'Secondary menu — Quick Reply: Healthy suggestions / Support / Main menu'),
  ('wa_vendor_list',      '', 'Vendor List Picker — up to 10 nearby vendors'),
  ('wa_menu_list',        '', 'Menu List Picker — up to 10 items per vendor'),
  ('wa_cart_actions',     '', 'Cart actions — Quick Reply: Checkout / Add more / Clear cart'),
  ('wa_delivery_choice',  '', 'Delivery choice — Quick Reply: Deliver to me / Carryout / Cancel'),
  ('wa_confirm_order',    '', 'Confirm order — Quick Reply: Confirm & Pay / Cancel'),
  ('wa_account_setup',    '', 'Account setup — Quick Reply: Create account / I have one / Maybe later'),
  ('wa_request_location', '', 'Request location — Quick Reply: Share location / Use saved address / Skip')
ON CONFLICT (template_key) DO NOTHING;