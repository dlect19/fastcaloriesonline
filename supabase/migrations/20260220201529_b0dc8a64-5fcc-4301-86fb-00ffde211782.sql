
-- Update the auto-process trigger to use the anon key (verify_jwt is false for process-payout)
CREATE OR REPLACE FUNCTION public.auto_process_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_approval_mode TEXT;
BEGIN
  -- Only run on INSERT with status 'pending'
  IF TG_OP != 'INSERT' OR NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Check if auto-approval is enabled
  SELECT value INTO v_approval_mode
  FROM platform_settings
  WHERE key = 'payout_approval_mode';

  IF COALESCE(v_approval_mode, 'manual') != 'auto' THEN
    RETURN NEW;
  END IF;

  -- Use pg_net to call the process-payout edge function asynchronously
  -- Using service_role key from Supabase vault/settings
  PERFORM net.http_post(
    url := 'https://yrfbvuiinvytlvouzyxv.supabase.co/functions/v1/process-payout',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZmJ2dWlpbnZ5dGx2b3V6eXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNzc2MDQsImV4cCI6MjA4NDk1MzYwNH0.Wf-wJbxadtniANyyrQoU0NXeIheU46sOTz6nrzgLSos"}'::jsonb,
    body := jsonb_build_object('payout_request_id', NEW.id)
  );

  RAISE LOG 'Auto-processing payout request % via pg_net', NEW.id;

  RETURN NEW;
END;
$$;
