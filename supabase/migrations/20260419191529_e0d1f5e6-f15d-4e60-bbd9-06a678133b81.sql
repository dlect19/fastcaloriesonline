
-- ============================================================
-- 1. PRODUCTS: stock tracking columns
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_quantity integer,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS track_stock boolean DEFAULT false;

-- ============================================================
-- 2. ORDERS: POS channel columns
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS pos_cashier_id uuid,
  ADD COLUMN IF NOT EXISTS pos_payment_method text,
  ADD COLUMN IF NOT EXISTS pos_session_id uuid;

CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_pos_session ON public.orders(pos_session_id);

-- ============================================================
-- 3. POS SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pos_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_id uuid REFERENCES public.vendor_outlets(id) ON DELETE SET NULL,
  cashier_id uuid NOT NULL,
  cashier_name text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_difference numeric(12,2),
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  cash_sales numeric(12,2) NOT NULL DEFAULT 0,
  transfer_sales numeric(12,2) NOT NULL DEFAULT 0,
  card_sales numeric(12,2) NOT NULL DEFAULT 0,
  wallet_sales numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_sessions_vendor ON public.pos_sessions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_outlet ON public.pos_sessions(outlet_id);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_cashier ON public.pos_sessions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_status ON public.pos_sessions(status);

ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor team views POS sessions"
ON public.pos_sessions FOR SELECT
USING (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  OR cashier_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.vendor_id = pos_sessions.vendor_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Vendor team creates POS sessions"
ON public.pos_sessions FOR INSERT
WITH CHECK (
  cashier_id = auth.uid()
  AND (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs
      WHERE vs.vendor_id = pos_sessions.vendor_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
  )
);

CREATE POLICY "Vendor team updates POS sessions"
ON public.pos_sessions FOR UPDATE
USING (
  cashier_id = auth.uid()
  OR vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
);

-- ============================================================
-- 4. POS DEVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_id uuid REFERENCES public.vendor_outlets(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  device_id text,
  paper_width_mm integer NOT NULL DEFAULT 58,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_devices_vendor ON public.pos_devices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pos_devices_outlet ON public.pos_devices(outlet_id);

ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor team views POS devices"
ON public.pos_devices FOR SELECT
USING (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.vendor_id = pos_devices.vendor_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Vendor team manages POS devices"
ON public.pos_devices FOR ALL
USING (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.vendor_id = pos_devices.vendor_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
      AND vs.role IN ('owner','manager')
  )
);

-- ============================================================
-- 5. STOCK MOVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_id uuid REFERENCES public.vendor_outlets(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  quantity_change integer NOT NULL,
  quantity_before integer,
  quantity_after integer,
  reason text,
  reference_id uuid,
  reference_type text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_vendor ON public.stock_movements(vendor_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON public.stock_movements(created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor team views stock movements"
ON public.stock_movements FOR SELECT
USING (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.vendor_id = stock_movements.vendor_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Vendor team logs stock movements"
ON public.stock_movements FOR INSERT
WITH CHECK (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.vendor_id = stock_movements.vendor_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
);

-- ============================================================
-- 6. STOCK ADJUSTMENT FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id uuid,
  p_quantity_change integer,
  p_movement_type text,
  p_reason text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_new_qty integer;
  v_now_unavailable boolean := false;
BEGIN
  SELECT id, vendor_id, outlet_id, stock_quantity, track_stock, is_available, name
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  IF NOT COALESCE(v_product.track_stock, false) THEN
    RETURN jsonb_build_object('success', true, 'tracked', false);
  END IF;

  v_new_qty := COALESCE(v_product.stock_quantity, 0) + p_quantity_change;

  IF v_new_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient stock', 'available', COALESCE(v_product.stock_quantity, 0));
  END IF;

  IF v_new_qty = 0 AND v_product.is_available = true THEN
    v_now_unavailable := true;
  END IF;

  UPDATE public.products
  SET stock_quantity = v_new_qty,
      is_available = CASE WHEN v_new_qty = 0 THEN false
                          WHEN v_new_qty > 0 AND is_available = false AND p_quantity_change > 0 THEN true
                          ELSE is_available END,
      updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id, vendor_id, outlet_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, reference_id, reference_type, created_by
  ) VALUES (
    p_product_id, v_product.vendor_id, v_product.outlet_id, p_movement_type, p_quantity_change,
    COALESCE(v_product.stock_quantity, 0), v_new_qty, p_reason, p_reference_id, p_reference_type, auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tracked', true,
    'new_quantity', v_new_qty,
    'auto_marked_unavailable', v_now_unavailable
  );
END;
$$;

-- ============================================================
-- 7. AUTO-DECREMENT ON ORDER STATUS CHANGE
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_order_stock_decrement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status IN ('confirmed','preparing','completed','delivered'))
     OR (TG_OP = 'UPDATE' AND NEW.status IN ('confirmed','preparing','completed','delivered')
         AND OLD.status NOT IN ('confirmed','preparing','completed','delivered')) THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = NEW.id
        AND oi.product_id IS NOT NULL
        AND COALESCE(p.track_stock, false) = true
    LOOP
      PERFORM public.adjust_product_stock(
        v_item.product_id, -v_item.quantity, 'sale',
        'Order ' || COALESCE(NEW.order_number, NEW.id::text),
        NEW.id, 'order'
      );
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled'
     AND OLD.status IN ('confirmed','preparing','completed','delivered') THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = NEW.id
        AND oi.product_id IS NOT NULL
        AND COALESCE(p.track_stock, false) = true
    LOOP
      PERFORM public.adjust_product_stock(
        v_item.product_id, v_item.quantity, 'restock',
        'Cancelled order ' || COALESCE(NEW.order_number, NEW.id::text),
        NEW.id, 'order_cancellation'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_stock_decrement ON public.orders;
CREATE TRIGGER trg_order_stock_decrement
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_stock_decrement();

-- ============================================================
-- 8. PHARMACY DEFAULT STOCK TRACKING
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_pharmacy_default_stock_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.track_stock IS NULL OR NEW.track_stock = false THEN
    IF EXISTS (SELECT 1 FROM public.vendors WHERE id = NEW.vendor_id AND category = 'pharmacy') THEN
      NEW.track_stock := true;
      IF NEW.stock_quantity IS NULL THEN NEW.stock_quantity := 0; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharmacy_default_stock ON public.products;
CREATE TRIGGER trg_pharmacy_default_stock
BEFORE INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_pharmacy_default_stock_tracking();

-- ============================================================
-- 9. updated_at trigger for pos_sessions
-- ============================================================
DROP TRIGGER IF EXISTS trg_pos_sessions_updated_at ON public.pos_sessions;
CREATE TRIGGER trg_pos_sessions_updated_at
BEFORE UPDATE ON public.pos_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 10. Realtime publication for products
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'products'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.products';
  END IF;
END $$;
