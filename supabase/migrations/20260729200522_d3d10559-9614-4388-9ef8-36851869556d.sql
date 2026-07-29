-- 1. Extend existing drug_reminders into full medication schedules
ALTER TABLE public.drug_reminders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS instruction_source text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS strength text,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS days_of_week smallint[],
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS times_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doses_per_day smallint;

ALTER TABLE public.drug_reminders
  ALTER COLUMN reminder_times SET DEFAULT '{}'::time[];

DO $$ BEGIN
  ALTER TABLE public.drug_reminders
    ADD CONSTRAINT drug_reminders_status_chk
    CHECK (status IN ('draft','active','paused','completed','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.drug_reminders
    ADD CONSTRAINT drug_reminders_source_chk
    CHECK (source IN ('pharmacy_order','prescription_extraction','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.drug_reminders
    ADD CONSTRAINT drug_reminders_verification_chk
    CHECK (verification_status IN ('unverified','pending_verification','verified','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Safe data migration of existing rows
UPDATE public.drug_reminders
SET status = CASE WHEN is_active THEN 'active' ELSE 'paused' END,
    source = CASE WHEN prescription_order_id IS NOT NULL THEN 'pharmacy_order' ELSE 'manual' END,
    activated_at = COALESCE(activated_at, created_at)
WHERE status = 'active' AND activated_at IS NULL;

CREATE INDEX IF NOT EXISTS drug_reminders_user_status_idx
  ON public.drug_reminders(user_id, status);

-- 2. Dose occurrence log
CREATE TABLE IF NOT EXISTS public.medication_doses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES public.drug_reminders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  drug_usage_tracking_id uuid,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  taken_at timestamptz,
  snoozed_until timestamptz,
  snooze_count smallint NOT NULL DEFAULT 0,
  client_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_doses_status_chk CHECK (status IN ('pending','taken','skipped','snoozed','missed')),
  CONSTRAINT medication_doses_client_key_uniq UNIQUE (user_id, client_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_doses TO authenticated;
GRANT ALL ON public.medication_doses TO service_role;
ALTER TABLE public.medication_doses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own dose log"
  ON public.medication_doses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS medication_doses_user_time_idx
  ON public.medication_doses(user_id, scheduled_for DESC);

-- 3. Per-user reminder settings
CREATE TABLE IF NOT EXISTS public.medication_settings (
  user_id uuid PRIMARY KEY,
  notifications_enabled boolean NOT NULL DEFAULT true,
  privacy_mode boolean NOT NULL DEFAULT false,
  calendar_sync_enabled boolean NOT NULL DEFAULT false,
  snooze_minutes smallint NOT NULL DEFAULT 10,
  sound_enabled boolean NOT NULL DEFAULT true,
  vibration_enabled boolean NOT NULL DEFAULT true,
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_settings TO authenticated;
GRANT ALL ON public.medication_settings TO service_role;
ALTER TABLE public.medication_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own medication settings"
  ON public.medication_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Operational diagnostics (no medication details)
CREATE TABLE IF NOT EXISTS public.medication_reminder_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text NOT NULL,
  platform text,
  app_version text,
  os_version text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.medication_reminder_diagnostics TO authenticated;
GRANT SELECT ON public.medication_reminder_diagnostics TO authenticated;
GRANT ALL ON public.medication_reminder_diagnostics TO service_role;
ALTER TABLE public.medication_reminder_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users log their own reminder diagnostics"
  ON public.medication_reminder_diagnostics FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read reminder diagnostics"
  ON public.medication_reminder_diagnostics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS med_diag_event_idx
  ON public.medication_reminder_diagnostics(event_type, created_at DESC);

-- 5. Pharmacy staff verification access to schedules for orders they fulfil
CREATE POLICY "Pharmacy staff verify schedules for their orders"
  ON public.drug_reminders FOR SELECT TO authenticated
  USING (
    prescription_order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.prescription_orders po
      WHERE po.id = drug_reminders.prescription_order_id
        AND public.owns_vendor(auth.uid(), po.vendor_id)
    )
  );

CREATE POLICY "Pharmacy staff update verification for their orders"
  ON public.drug_reminders FOR UPDATE TO authenticated
  USING (
    prescription_order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.prescription_orders po
      WHERE po.id = drug_reminders.prescription_order_id
        AND public.owns_vendor(auth.uid(), po.vendor_id)
    )
  );

-- 6. updated_at triggers
CREATE TRIGGER medication_doses_set_updated_at
  BEFORE UPDATE ON public.medication_doses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER medication_settings_set_updated_at
  BEFORE UPDATE ON public.medication_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();