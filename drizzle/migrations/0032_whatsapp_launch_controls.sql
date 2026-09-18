-- Admin-managed testing allowlist for the pre-launch WhatsApp gate.
CREATE TABLE public.whatsapp_launch_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  normalized_phone text NOT NULL,
  phone_verified boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  added_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_launch_allowlist_user_unique UNIQUE (user_id)
);

CREATE INDEX whatsapp_launch_allowlist_phone_idx
  ON public.whatsapp_launch_allowlist (normalized_phone);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_launch_allowlist TO authenticated;
GRANT ALL ON public.whatsapp_launch_allowlist TO service_role;

ALTER TABLE public.whatsapp_launch_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage whatsapp launch allowlist"
  ON public.whatsapp_launch_allowlist
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Stored language preference for the pre-launch reply (no AI call needed).
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS language text;