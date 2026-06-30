CREATE OR REPLACE FUNCTION public.prevent_late_customer_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only police transitions to 'cancelled'
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    -- If the actor is the customer who owns the order, enforce the cancellation window.
    -- Orders store the customer account in user_id, not customer_id.
    IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
      IF OLD.status NOT IN ('pending', 'confirmed') THEN
        RAISE EXCEPTION 'Order can no longer be cancelled — preparation has started (status: %).', OLD.status
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;