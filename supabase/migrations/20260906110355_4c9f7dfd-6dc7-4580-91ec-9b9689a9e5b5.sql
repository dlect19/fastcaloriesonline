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
  v_vendor_ids uuid[];
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

  -- Vendors affected by this operation
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

  -- Recompute the vendor-level companion flag from the actual outlet rows.
  -- Vendors with no active+approved outlets keep their prior state.
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

  -- Vendors in scope that have no active+approved outlets: fall back to their own schedule,
  -- only when they are not currently admin-force-closed.
  UPDATE public.vendors v
  SET is_open = public.schedule_open_now(v.id, NULL)
  WHERE v.is_active
    AND v.id = ANY(v_vendor_ids)
    AND NOT v.admin_force_closed
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_outlets o
      WHERE o.vendor_id = v.id AND o.is_active AND o.is_approved
    );

  RETURN v_count;
END;
$$;