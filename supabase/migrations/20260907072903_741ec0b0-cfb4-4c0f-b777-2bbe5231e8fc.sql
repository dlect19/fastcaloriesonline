-- Deterministic, time-injectable schedule evaluator
CREATE OR REPLACE FUNCTION public.schedule_open_at(
  _vendor_id uuid,
  _outlet_id uuid,
  _at timestamp
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dow int := EXTRACT(DOW FROM _at)::int;
  v_time time := _at::time;
  v_has_outlet_rows boolean := false;
  v_has_vendor_rows boolean := false;
  v_open boolean;
BEGIN
  IF _outlet_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vendor_working_hours WHERE outlet_id = _outlet_id
    ) INTO v_has_outlet_rows;
  END IF;

  IF v_has_outlet_rows THEN
    -- Outlet has its own schedule: today's rows are authoritative.
    SELECT COALESCE(bool_or(
      NOT COALESCE(is_closed, false)
      AND (
        CASE WHEN close_time <= open_time
          THEN (v_time >= open_time OR v_time < close_time)
          ELSE (v_time >= open_time AND v_time < close_time)
        END
      )
    ), false)
    INTO v_open
    FROM public.vendor_working_hours
    WHERE outlet_id = _outlet_id AND day_of_week = v_dow;

    RETURN COALESCE(v_open, false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vendor_working_hours
    WHERE vendor_id = _vendor_id AND outlet_id IS NULL
  ) INTO v_has_vendor_rows;

  IF NOT v_has_vendor_rows THEN
    -- No schedule configured anywhere: preserve prior behaviour (treat as open)
    RETURN true;
  END IF;

  SELECT COALESCE(bool_or(
    NOT COALESCE(is_closed, false)
    AND (
      CASE WHEN close_time <= open_time
        THEN (v_time >= open_time OR v_time < close_time)
        ELSE (v_time >= open_time AND v_time < close_time)
      END
    )
  ), false)
  INTO v_open
  FROM public.vendor_working_hours
  WHERE vendor_id = _vendor_id AND outlet_id IS NULL AND day_of_week = v_dow;

  RETURN COALESCE(v_open, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.schedule_open_at(uuid, uuid, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_open_at(uuid, uuid, timestamp) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_open_at(uuid, uuid, timestamp) TO authenticated, service_role;

-- schedule_open_now now delegates to the injectable evaluator using current Lagos time
CREATE OR REPLACE FUNCTION public.schedule_open_now(_vendor_id uuid, _outlet_id uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.schedule_open_at(_vendor_id, _outlet_id, (now() AT TIME ZONE 'Africa/Lagos'));
$function$;

REVOKE ALL ON FUNCTION public.schedule_open_now(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_open_now(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_open_now(uuid, uuid) TO authenticated, service_role;

-- Resume must always derive is_open freshly from the schedule, never from history
CREATE OR REPLACE FUNCTION public.admin_set_outlet_availability(_force_closed boolean, _outlet_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_now timestamp := (now() AT TIME ZONE 'Africa/Lagos');
  v_vendor_ids uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change platform availability';
  END IF;

  WITH upd AS (
    UPDATE public.vendor_outlets o
    SET admin_force_closed = _force_closed,
        admin_override_updated_at = now(),
        admin_override_updated_by = auth.uid(),
        is_open = CASE
          WHEN _force_closed THEN false
          ELSE public.schedule_open_at(o.vendor_id, o.id, v_now)
        END
    WHERE o.is_active AND o.is_approved
      AND (_outlet_id IS NULL OR o.id = _outlet_id)
    RETURNING o.id
  )
  SELECT count(*) INTO v_count FROM upd;

  IF _outlet_id IS NULL THEN
    SELECT array_agg(DISTINCT o.vendor_id) INTO v_vendor_ids
    FROM public.vendor_outlets o
    WHERE o.is_active AND o.is_approved;
  ELSE
    SELECT array_agg(DISTINCT o.vendor_id) INTO v_vendor_ids
    FROM public.vendor_outlets o
    WHERE o.id = _outlet_id;
  END IF;

  IF v_vendor_ids IS NULL THEN
    RETURN v_count;
  END IF;

  -- Recompute vendor-level flags from the freshly evaluated outlet rows
  UPDATE public.vendors v
  SET admin_force_closed = agg.all_forced,
      admin_override_updated_at = now(),
      admin_override_updated_by = auth.uid(),
      is_open = CASE WHEN agg.all_forced THEN false ELSE agg.any_open END
  FROM (
    SELECT o.vendor_id,
           bool_and(o.admin_force_closed) AS all_forced,
           bool_or(COALESCE(o.is_open, false) AND NOT o.admin_force_closed) AS any_open
    FROM public.vendor_outlets o
    WHERE o.is_active AND o.is_approved
      AND o.vendor_id = ANY(v_vendor_ids)
    GROUP BY o.vendor_id
  ) agg
  WHERE v.id = agg.vendor_id AND v.is_active;

  -- Vendors with no active+approved outlets: evaluate their own schedule freshly
  UPDATE public.vendors v
  SET admin_force_closed = _force_closed,
      admin_override_updated_at = now(),
      admin_override_updated_by = auth.uid(),
      is_open = CASE WHEN _force_closed THEN false
                     ELSE public.schedule_open_at(v.id, NULL, v_now) END
  WHERE v.is_active
    AND v.id = ANY(v_vendor_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_outlets o
      WHERE o.vendor_id = v.id AND o.is_active AND o.is_approved
    );

  RETURN v_count;
END;
$function$;