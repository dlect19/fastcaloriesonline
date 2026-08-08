ALTER TABLE public.drug_reminders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS days_of_week integer[],
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS instruction_source text DEFAULT 'customer_entered',
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified';

CREATE TABLE IF NOT EXISTS public.medication_doses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reminder_id uuid NOT NULL REFERENCES public.drug_reminders(id) ON DELETE CASCADE,
  drug_usage_tracking_id uuid,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'taken',
  taken_at timestamptz,
  snoozed_until timestamptz,
  client_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_doses TO authenticated;
GRANT ALL ON public.medication_doses TO service_role;
ALTER TABLE public.medication_doses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own medication doses" ON public.medication_doses
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS medication_doses_user_time_idx ON public.medication_doses (user_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS public.medication_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  notifications_enabled boolean NOT NULL DEFAULT true,
  privacy_mode boolean NOT NULL DEFAULT false,
  calendar_sync_enabled boolean NOT NULL DEFAULT false,
  snooze_minutes integer NOT NULL DEFAULT 10,
  sound_enabled boolean NOT NULL DEFAULT true,
  vibration_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_settings TO authenticated;
GRANT ALL ON public.medication_settings TO service_role;
ALTER TABLE public.medication_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own medication settings" ON public.medication_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.medication_reminder_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  platform text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.medication_reminder_diagnostics TO authenticated;
GRANT ALL ON public.medication_reminder_diagnostics TO service_role;
ALTER TABLE public.medication_reminder_diagnostics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own medication diagnostics" ON public.medication_reminder_diagnostics
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users view own medication diagnostics" ON public.medication_reminder_diagnostics
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_medication_doses_updated_at BEFORE UPDATE ON public.medication_doses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_medication_settings_updated_at BEFORE UPDATE ON public.medication_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();