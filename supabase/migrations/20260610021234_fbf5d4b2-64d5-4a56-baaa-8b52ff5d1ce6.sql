
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS receiver_name TEXT,
  ADD COLUMN IF NOT EXISTS receiver_phone TEXT,
  ADD COLUMN IF NOT EXISTS communication_notes TEXT,
  ADD COLUMN IF NOT EXISTS assisted_created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_assisted_created_by ON public.orders(assisted_created_by) WHERE assisted_created_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_manage_assisted_orders(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'admin'
  ) AND (
    NOT EXISTS (SELECT 1 FROM public.admin_staff s WHERE s.user_id = _user_id AND s.is_active = true)
    OR EXISTS (SELECT 1 FROM public.admin_staff s WHERE s.user_id = _user_id AND s.is_active = true AND s.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.admin_staff s
      WHERE s.user_id = _user_id AND s.is_active = true
        AND s.permissions IS NOT NULL
        AND 'manage_assisted_orders' = ANY(s.permissions)
    )
  );
$$;

CREATE TABLE IF NOT EXISTS public.assisted_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_channel TEXT NOT NULL CHECK (customer_channel IN ('phone','whatsapp','sms','facebook','instagram','other')),
  channel_reference TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('paystack_link','bank_transfer','wallet','cash')),
  payment_link TEXT,
  payment_reference TEXT,
  payment_status TEXT NOT NULL DEFAULT 'awaiting' CHECK (payment_status IN ('awaiting','received','failed','cancelled')),
  payment_verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_verified_at TIMESTAMPTZ,
  bank_transfer_instructions TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  last_modified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assisted_orders TO authenticated;
GRANT ALL ON public.assisted_orders TO service_role;

ALTER TABLE public.assisted_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage assisted orders"
  ON public.assisted_orders FOR ALL TO authenticated
  USING (public.can_manage_assisted_orders(auth.uid()))
  WITH CHECK (public.can_manage_assisted_orders(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_assisted_orders_status ON public.assisted_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_assisted_orders_created_by ON public.assisted_orders(created_by);

CREATE OR REPLACE FUNCTION public.assisted_orders_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_assisted_orders_updated_at ON public.assisted_orders;
CREATE TRIGGER trg_assisted_orders_updated_at
  BEFORE UPDATE ON public.assisted_orders
  FOR EACH ROW EXECUTE FUNCTION public.assisted_orders_set_updated_at();

CREATE TABLE IF NOT EXISTS public.assisted_order_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.assisted_order_audit TO authenticated;
GRANT ALL ON public.assisted_order_audit TO service_role;

ALTER TABLE public.assisted_order_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit"
  ON public.assisted_order_audit FOR SELECT TO authenticated
  USING (public.can_manage_assisted_orders(auth.uid()));

CREATE POLICY "Admins write audit"
  ON public.assisted_order_audit FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_assisted_orders(auth.uid()) AND actor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_assisted_order_audit_order ON public.assisted_order_audit(order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_public_order_tracking(_order_number text)
RETURNS TABLE (
  order_number text,
  status order_status,
  delivery_type text,
  vendor_name text,
  rider_first_name text,
  estimated_delivery_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    o.order_number,
    o.status,
    o.delivery_type,
    v.name AS vendor_name,
    split_part(COALESCE(rp.full_name,''), ' ', 1) AS rider_first_name,
    o.estimated_delivery_at,
    o.delivered_at,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.vendors v ON v.id = o.vendor_id
  LEFT JOIN public.profiles rp ON rp.id = o.rider_id
  WHERE o.order_number = _order_number
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_order_tracking(text) TO anon, authenticated;
