CREATE OR REPLACE FUNCTION public.force_closed_keeps_store_shut()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.admin_force_closed, false) THEN
    NEW.is_open := false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_outlet_force_closed_shut ON public.vendor_outlets;
CREATE TRIGGER trg_outlet_force_closed_shut
BEFORE INSERT OR UPDATE ON public.vendor_outlets
FOR EACH ROW EXECUTE FUNCTION public.force_closed_keeps_store_shut();

DROP TRIGGER IF EXISTS trg_vendor_force_closed_shut ON public.vendors;
CREATE TRIGGER trg_vendor_force_closed_shut
BEFORE INSERT OR UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.force_closed_keeps_store_shut();

UPDATE public.vendor_outlets SET is_open = false WHERE admin_force_closed AND is_open IS DISTINCT FROM false;
UPDATE public.vendors SET is_open = false WHERE admin_force_closed AND is_open IS DISTINCT FROM false;