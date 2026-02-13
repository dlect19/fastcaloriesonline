
-- Enable pg_net extension for making HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to call notify-order-update edge function on order changes
CREATE OR REPLACE FUNCTION public.trigger_order_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_payload JSONB;
  v_status_changed BOOLEAN;
  v_payment_changed BOOLEAN;
  v_rider_changed BOOLEAN;
BEGIN
  v_status_changed := (OLD.status IS DISTINCT FROM NEW.status);
  v_payment_changed := (OLD.payment_status IS DISTINCT FROM NEW.payment_status);
  v_rider_changed := (OLD.rider_id IS DISTINCT FROM NEW.rider_id);

  -- Only fire if something notification-worthy changed
  IF NOT (v_status_changed OR v_payment_changed OR v_rider_changed) THEN
    RETURN NEW;
  END IF;

  -- Build payload
  v_payload := jsonb_build_object(
    'order_id', NEW.id,
    'old_status', OLD.status,
    'new_status', NEW.status,
    'old_payment_status', OLD.payment_status,
    'new_payment_status', NEW.payment_status,
    'old_rider_id', OLD.rider_id,
    'new_rider_id', NEW.rider_id
  );

  -- Get Supabase URL and service key from vault or hardcode project URL
  v_supabase_url := 'https://yrfbvuiinvytlvouzyxv.supabase.co';
  v_service_key := current_setting('supabase.service_role_key', true);

  -- If service key not available via setting, try from vault
  IF v_service_key IS NULL OR v_service_key = '' THEN
    -- Fallback: use the anon key (the edge function has verify_jwt = false)
    v_service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZmJ2dWlpbnZ5dGx2b3V6eXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNzc2MDQsImV4cCI6MjA4NDk1MzYwNH0.Wf-wJbxadtniANyyrQoU0NXeIheU46sOTz6nrzgLSos';
  END IF;

  -- Make async HTTP call to edge function
  PERFORM extensions.http_post(
    url := v_supabase_url || '/functions/v1/notify-order-update',
    body := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    )::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block order updates if notification fails
  RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_order_update_push_notification ON public.orders;
CREATE TRIGGER on_order_update_push_notification
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_order_push_notification();
