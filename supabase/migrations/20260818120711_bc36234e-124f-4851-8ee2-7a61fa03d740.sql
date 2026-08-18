ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS approval_status TEXT,
  ADD COLUMN IF NOT EXISTS approval_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_checked_at TIMESTAMPTZ;