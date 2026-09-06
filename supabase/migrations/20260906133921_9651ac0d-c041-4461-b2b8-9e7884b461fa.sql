-- 1) Backfill: admin override must be reflected in the legacy is_open flag
UPDATE public.vendor_outlets SET is_open = false WHERE admin_force_closed AND is_open IS DISTINCT FROM false;
UPDATE public.vendors SET is_open = false WHERE admin_force_closed AND is_open IS DISTINCT FROM false;

-- 2) Order guard: check BOTH outlet and parent vendor overrides
CREATE OR REPLACE FUNCTION public.enforce_admin_availability_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_outlet_blocked boolean := false;
  v_vendor_blocked boolean := false;
BEGIN
  -- In-store POS sales are not affected by online availability overrides
  IF NEW.pos_session_id IS NOT NULL OR NEW.channel = 'pos' THEN
    RETURN NEW;
  END IF;

  IF NEW.outlet_id IS NOT NULL THEN
    SELECT admin_force_closed INTO v_outlet_blocked FROM public.vendor_outlets WHERE id = NEW.outlet_id;
  END IF;

  IF NEW.vendor_id IS NOT NULL THEN
    SELECT admin_force_closed INTO v_vendor_blocked FROM public.vendors WHERE id = NEW.vendor_id;
  END IF;

  IF COALESCE(v_outlet_blocked, false) OR COALESCE(v_vendor_blocked, false) THEN
    RAISE EXCEPTION 'This store is temporarily unavailable for orders. Please try again later.';
  END IF;

  RETURN NEW;
END;
$function$;