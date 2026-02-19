
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
  v_response extensions.http_response;
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

  v_supabase_url := 'https://yrfbvuiinvytlvouzyxv.supabase.co';
  v_service_key := current_setting('supabase.service_role_key', true);

  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZmJ2dWlpbnZ5dGx2b3V6eXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNzc2MDQsImV4cCI6MjA4NDk1MzYwNH0.Wf-wJbxadtniANyyrQoU0NXeIheU46sOTz6nrzgLSos';
  END IF;

  -- Use the correct http() function with http_request composite type
  SELECT * INTO v_response FROM extensions.http((
    'POST',
    v_supabase_url || '/functions/v1/notify-order-update',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key)
    ],
    'application/json',
    v_payload::text
  )::extensions.http_request);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;
