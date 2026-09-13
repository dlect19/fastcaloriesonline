-- Durable WhatsApp cart + checkout state for the conversational ordering agent.
-- Additive only: existing whatsapp_sessions rows/carts are untouched.

CREATE TABLE IF NOT EXISTS public.whatsapp_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  customer_user_id UUID,
  vendor_id UUID,
  outlet_id UUID,
  fulfilment_type TEXT NOT NULL DEFAULT 'delivery',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  promo_code TEXT,
  payment_method TEXT,
  delivery_quote JSONB,
  quote_expires_at TIMESTAMPTZ,
  delivery_latitude NUMERIC,
  delivery_longitude NUMERIC,
  delivery_address_text TEXT,
  saved_address_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.whatsapp_carts TO service_role;
ALTER TABLE public.whatsapp_carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view whatsapp carts"
  ON public.whatsapp_carts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_carts_updated_at ON public.whatsapp_carts (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  customer_user_id UUID,
  session_id UUID,
  vendor_id UUID,
  outlet_id UUID,
  fulfilment_type TEXT NOT NULL DEFAULT 'delivery',
  payment_method TEXT NOT NULL DEFAULT 'wallet',
  status TEXT NOT NULL DEFAULT 'pending',
  cart_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  pricing_snapshot JSONB,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_reference TEXT,
  payment_link TEXT,
  order_id UUID,
  environment TEXT NOT NULL DEFAULT 'development',
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.whatsapp_checkouts TO service_role;
ALTER TABLE public.whatsapp_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view whatsapp checkouts"
  ON public.whatsapp_checkouts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_checkouts_reference ON public.whatsapp_checkouts (payment_reference);
CREATE INDEX IF NOT EXISTS idx_whatsapp_checkouts_status ON public.whatsapp_checkouts (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_whatsapp_agent_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_carts_touch ON public.whatsapp_carts;
CREATE TRIGGER trg_whatsapp_carts_touch BEFORE UPDATE ON public.whatsapp_carts
  FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_agent_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_checkouts_touch ON public.whatsapp_checkouts;
CREATE TRIGGER trg_whatsapp_checkouts_touch BEFORE UPDATE ON public.whatsapp_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_agent_updated_at();