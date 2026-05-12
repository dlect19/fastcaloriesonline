CREATE OR REPLACE FUNCTION public.trigger_order_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supabase_url TEXT := 'https://bruyccrjymmpzulqhotw.supabase.co';
  v_service_key TEXT;
  v_payload JSONB;
  v_status_changed BOOLEAN;
  v_payment_changed BOOLEAN;
  v_rider_changed BOOLEAN;
BEGIN
  v_status_changed := (OLD.status IS DISTINCT FROM NEW.status);
  v_payment_changed := (OLD.payment_status IS DISTINCT FROM NEW.payment_status);
  v_rider_changed := (OLD.rider_id IS DISTINCT FROM NEW.rider_id);

  IF NOT (v_status_changed OR v_payment_changed OR v_rider_changed) THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'order_id', NEW.id,
    'old_status', OLD.status,
    'new_status', NEW.status,
    'old_payment_status', OLD.payment_status,
    'new_payment_status', NEW.payment_status,
    'old_rider_id', OLD.rider_id,
    'new_rider_id', NEW.rider_id
  );

  v_service_key := current_setting('supabase.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJydXljY3JqeW1tcHp1bHFob3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMTY1NzQsImV4cCI6MjA4Nzg5MjU3NH0.NK_Rpz38e21ZBQlYaIxWBKDv6GQbY1KgATFFUa_M9JQ';
  END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/notify-order-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;