-- Add invite_code and invite_email columns to vendor_staff
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- Add invite_code, invite_email, and invite_accepted_at columns to admin_staff
ALTER TABLE public.admin_staff ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;
ALTER TABLE public.admin_staff ADD COLUMN IF NOT EXISTS invite_email TEXT;
ALTER TABLE public.admin_staff ADD COLUMN IF NOT EXISTS invite_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.admin_staff ADD COLUMN IF NOT EXISTS invited_by UUID;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_vendor_staff_invite_code ON public.vendor_staff(invite_code);
CREATE INDEX IF NOT EXISTS idx_admin_staff_invite_code ON public.admin_staff(invite_code);