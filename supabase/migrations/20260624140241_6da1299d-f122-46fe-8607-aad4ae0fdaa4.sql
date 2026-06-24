
-- =========================================================
-- Phase 1: Admin staff ops infrastructure
--   * Hard-block customer cancel once status >= preparing
--   * orders.attended_by_staff_id / attended_at / vendor_called_at
--   * platform_settings.staff_attend_after_seconds (configurable)
--   * admin_staff.last_activity_at (presence/active tracking)
--   * RPC log_admin_activity()  — writes activity_logs + bumps last_activity_at
--   * RPC attend_order()        — staff "I'm on it" tick (gated by timer)
-- =========================================================

-- 1) Customer cancel hard-block trigger ---------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_late_customer_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only police transitions to 'cancelled'
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    -- If the actor is the customer who owns the order, enforce the window
    IF auth.uid() IS NOT NULL AND auth.uid() = OLD.customer_id THEN
      IF OLD.status NOT IN ('pending', 'confirmed') THEN
        RAISE EXCEPTION 'Order can no longer be cancelled — preparation has started (status: %).', OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_late_customer_cancel ON public.orders;
CREATE TRIGGER trg_prevent_late_customer_cancel
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_late_customer_cancel();


-- 2) Orders: attended-by columns ---------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attended_by_staff_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attended_at          timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_called_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_attended_by_staff_id
  ON public.orders(attended_by_staff_id) WHERE attended_by_staff_id IS NOT NULL;


-- 3) Platform setting: how long until "Attend" button activates ---------------
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'staff_attend_after_seconds',
  '120',
  'Seconds after order creation before the admin staff "Attend / Call Vendor" button activates (only when vendor has not yet confirmed).'
)
ON CONFLICT (key) DO NOTHING;


-- 4) admin_staff: last_activity_at -------------------------------------------
ALTER TABLE public.admin_staff
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_admin_staff_last_activity_at
  ON public.admin_staff(last_activity_at DESC);


-- 5) RPC: log_admin_activity --------------------------------------------------
-- Single helper any admin/staff screen can call. Writes activity_logs and
-- bumps admin_staff.last_activity_at so we can compute Active / Inactive.
CREATE OR REPLACE FUNCTION public.log_admin_activity(
  _action       text,
  _entity_type  text,
  _entity_id    uuid    DEFAULT NULL,
  _details      jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _log_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'log_admin_activity requires an authenticated user';
  END IF;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, details)
  VALUES (_uid, _action, _entity_type, _entity_id, _details)
  RETURNING id INTO _log_id;

  -- Bump presence for staff rows (no-op for super admins / vendors)
  UPDATE public.admin_staff
     SET last_activity_at = now()
   WHERE user_id = _uid;

  RETURN _log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_activity(text, text, uuid, jsonb) TO authenticated;


-- 6) RPC: attend_order --------------------------------------------------------
-- Staff "I'm on it" tick. Gated by:
--   * caller must be admin or admin staff
--   * order must still be pending/confirmed (i.e. vendor hasn't acted)
--   * seconds since creation must be >= staff_attend_after_seconds
-- Records who attended, when, and writes an activity log entry.
CREATE OR REPLACE FUNCTION public.attend_order(_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid           uuid := auth.uid();
  _is_admin      boolean;
  _threshold     int;
  _order         public.orders;
  _age_seconds   numeric;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Must be a platform admin (super admin role) OR admin staff row
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
         )
         OR EXISTS (
           SELECT 1 FROM public.admin_staff WHERE user_id = _uid AND is_active = true
         )
    INTO _is_admin;

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Only admin staff can attend orders';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Order is no longer awaiting vendor (status: %).', _order.status;
  END IF;

  SELECT COALESCE((value)::int, 120)
    INTO _threshold
    FROM public.platform_settings
   WHERE key = 'staff_attend_after_seconds';
  IF _threshold IS NULL THEN _threshold := 120; END IF;

  _age_seconds := EXTRACT(EPOCH FROM (now() - _order.created_at));
  IF _age_seconds < _threshold THEN
    RAISE EXCEPTION 'Too early to attend — vendor has % more seconds to respond.',
      ceil(_threshold - _age_seconds);
  END IF;

  UPDATE public.orders
     SET attended_by_staff_id = _uid,
         attended_at          = COALESCE(attended_at, now()),
         vendor_called_at     = now()
   WHERE id = _order_id
   RETURNING * INTO _order;

  PERFORM public.log_admin_activity(
    'order_attended',
    'order',
    _order_id,
    jsonb_build_object(
      'order_number', _order.order_number,
      'previous_status', _order.status,
      'age_seconds', _age_seconds
    )
  );

  RETURN _order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attend_order(uuid) TO authenticated;
