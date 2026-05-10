
CREATE TABLE IF NOT EXISTS public.platform_settings_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  changed_by uuid,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  action text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_audit_key_time
  ON public.platform_settings_audit (setting_key, changed_at DESC);

ALTER TABLE public.platform_settings_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read platform settings audit" ON public.platform_settings_audit;
CREATE POLICY "Admins can read platform settings audit"
  ON public.platform_settings_audit
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.log_platform_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.platform_settings_audit (setting_key, old_value, new_value, changed_by, action)
    VALUES (NEW.key, NULL, NEW.value, auth.uid(), 'INSERT');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.value IS DISTINCT FROM OLD.value THEN
      INSERT INTO public.platform_settings_audit (setting_key, old_value, new_value, changed_by, action)
      VALUES (NEW.key, OLD.value, NEW.value, auth.uid(), 'UPDATE');
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_platform_settings_change ON public.platform_settings;
CREATE TRIGGER trg_log_platform_settings_change
AFTER INSERT OR UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.log_platform_settings_change();
