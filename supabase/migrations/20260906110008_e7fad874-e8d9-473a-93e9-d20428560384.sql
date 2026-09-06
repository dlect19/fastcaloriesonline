ALTER TABLE public.vendor_outlets
  ADD COLUMN IF NOT EXISTS admin_force_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_override_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_override_updated_by uuid;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS admin_force_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_override_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_override_updated_by uuid;

CREATE INDEX IF NOT EXISTS idx_vendor_outlets_admin_force_closed
  ON public.vendor_outlets (admin_force_closed) WHERE admin_force_closed;

-- Compute schedule-based open state from the existing vendor_working_hours source (Africa/Lagos)
CREATE OR REPLACE FUNCTION public.schedule_open_now(_vendor_id uuid, _outlet_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamp;
  v_dow int;
  v_time time;
  v_row record;
BEGIN
  v_now := (now() AT TIME ZONE 'Africa/Lagos');
  v_dow := EXTRACT(DOW FROM v_now)::int;
  v_time := v_now::time;

  IF _outlet_id IS NOT NULL THEN
    SELECT open_time, close_time, is_closed INTO v_row
    FROM public.vendor_working_hours
    WHERE outlet_id = _outlet_id AND day_of_week = v_dow
    LIMIT 1;
  END IF;

  IF v_row IS NULL THEN
    SELECT open_time, close_time, is_closed INTO v_row
    FROM public.vendor_working_hours
    WHERE vendor_id = _vendor_id AND outlet_id IS NULL AND day_of_week = v_dow
    LIMIT 1;
  END IF;

  -- No schedule configured: keep prior behaviour (treat as open)
  IF v_row IS NULL THEN
    RETURN true;
  END IF;

  IF COALESCE(v_row.is_closed, false) THEN
    RETURN false;
  END IF;

  IF v_row.close_time <= v_row.open_time THEN
    -- overnight schedule
    RETURN v_time >= v_row.open_time OR v_time < v_row.close_time;
  END IF;

  RETURN v_time >= v_row.open_time AND v_time < v_row.close_time;
END;
$$;

-- Admin: set or clear the force-closed override. Clearing recalculates is_open from the schedule.
CREATE OR REPLACE FUNCTION public.admin_set_outlet_availability(
  _force_closed boolean,
  _outlet_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change platform availability';
  END IF;

  FOR r IN
    SELECT o.id, o.vendor_id
    FROM public.vendor_outlets o
    WHERE o.is_active AND o.is_approved
      AND (_outlet_id IS NULL OR o.id = _outlet_id)
  LOOP
    UPDATE public.vendor_outlets
    SET admin_force_closed = _force_closed,
        admin_override_updated_at = now(),
        admin_override_updated_by = auth.uid(),
        is_open = CASE
          WHEN _force_closed THEN false
          ELSE public.schedule_open_now(r.vendor_id, r.id)
        END
    WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  -- Keep vendor-level legacy flag in sync for the vendors touched
  UPDATE public.vendors v
  SET admin_force_closed = _force_closed,
      admin_override_updated_at = now(),
      admin_override_updated_by = auth.uid(),
      is_open = CASE
        WHEN _force_closed THEN false
        ELSE public.schedule_open_now(v.id, NULL)
      END
  WHERE v.is_active
    AND (
      _outlet_id IS NULL
      OR v.id = (SELECT vendor_id FROM public.vendor_outlets WHERE id = _outlet_id)
    );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_open_now(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_outlet_availability(boolean, uuid) TO authenticated, service_role;

-- Server-side enforcement: no order may be created against an admin-force-closed outlet/vendor
CREATE OR REPLACE FUNCTION public.enforce_admin_availability_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked boolean := false;
BEGIN
  -- In-store POS sales are not affected by online availability overrides
  IF NEW.pos_session_id IS NOT NULL OR NEW.channel = 'pos' THEN
    RETURN NEW;
  END IF;

  IF NEW.outlet_id IS NOT NULL THEN
    SELECT admin_force_closed INTO v_blocked FROM public.vendor_outlets WHERE id = NEW.outlet_id;
  ELSE
    SELECT admin_force_closed INTO v_blocked FROM public.vendors WHERE id = NEW.vendor_id;
  END IF;

  IF COALESCE(v_blocked, false) THEN
    RAISE EXCEPTION 'This store is temporarily unavailable for orders. Please try again later.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_admin_availability_on_order ON public.orders;
CREATE TRIGGER trg_enforce_admin_availability_on_order
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_availability_on_order();