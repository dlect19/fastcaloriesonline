
-- Auto-process payout requests when payout_approval_mode is 'auto'
-- Uses pg_net to call the process-payout edge function directly from the database

CREATE OR REPLACE FUNCTION public.auto_process_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_approval_mode TEXT;
  v_supabase_url TEXT;
  v_service_key TEXT;
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

  -- Get Supabase URL and service role key for the edge function call
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- If settings not available, try direct env approach
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := 'https://yrfbvuiinvytlvouzyxv.supabase.co';
  END IF;

  -- Use pg_net to call the process-payout edge function asynchronously
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/process-payout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true))
    ),
    body := jsonb_build_object('payout_request_id', NEW.id)
  );

  RAISE LOG 'Auto-processing payout request % via pg_net', NEW.id;

  RETURN NEW;
END;
$$;

-- Create trigger that fires AFTER insert (after deduct_wallet trigger has run)
CREATE TRIGGER auto_process_payout_on_insert
  AFTER INSERT ON payout_requests
  FOR EACH ROW
  EXECUTE FUNCTION auto_process_payout_request();
