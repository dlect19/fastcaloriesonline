
-- WhatsApp sessions
CREATE TABLE public.whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  customer_user_id UUID,
  state TEXT NOT NULL DEFAULT 'idle',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  cart JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_sessions_phone ON public.whatsapp_sessions(phone);
CREATE INDEX idx_wa_sessions_last ON public.whatsapp_sessions(last_message_at DESC);

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view sessions" ON public.whatsapp_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wa_sessions_updated BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- WhatsApp messages log
CREATE TABLE public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT,
  twilio_sid TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_msg_session ON public.whatsapp_messages(session_id, created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view messages" ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- WhatsApp orders bridge
CREATE TABLE public.whatsapp_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  payment_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_orders_phone ON public.whatsapp_orders(phone);
CREATE INDEX idx_wa_orders_order ON public.whatsapp_orders(order_id);

ALTER TABLE public.whatsapp_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view wa orders" ON public.whatsapp_orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wa_orders_updated BEFORE UPDATE ON public.whatsapp_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Platform setting flag
INSERT INTO public.platform_settings (key, value)
VALUES ('whatsapp_ordering_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
