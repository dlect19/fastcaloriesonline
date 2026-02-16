
-- 1. Verification status enum
DO $$ BEGIN
  CREATE TYPE public.vendor_verification_status AS ENUM (
    'unverified', 'pending_verification', 'verified', 'locked_pending_reverify'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add geo-lock columns to vendors
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS verified_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS verified_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS tolerance_radius_m INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS geo_verification_status TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS geo_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geo_lock_reason TEXT;

-- 3. Vendor verification documents table
CREATE TABLE IF NOT EXISTS public.vendor_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'cac_registration', 'utility_bill', 'storefront_photo', 'government_id', 'license'
  file_url TEXT NOT NULL,
  file_name TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vendor_verification_documents ENABLE ROW LEVEL SECURITY;

-- Vendors can see their own docs
CREATE POLICY "Vendors view own documents"
  ON public.vendor_verification_documents FOR SELECT
  USING (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Vendors can upload their own docs
CREATE POLICY "Vendors upload own documents"
  ON public.vendor_verification_documents FOR INSERT
  WITH CHECK (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  );

-- Admins can update (review) docs
CREATE POLICY "Admins update documents"
  ON public.vendor_verification_documents FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 4. Vendor location logs table (audit trail)
CREATE TABLE IF NOT EXISTS public.vendor_location_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'store_open_check', 'order_accept_check', 'manual_lock', 'manual_unlock', 'reverify_approved', 'reverify_rejected'
  device_latitude DOUBLE PRECISION,
  device_longitude DOUBLE PRECISION,
  verified_latitude DOUBLE PRECISION,
  verified_longitude DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  result TEXT, -- 'passed', 'failed', 'manual'
  performed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vendor_location_logs ENABLE ROW LEVEL SECURITY;

-- Vendors see own logs, admins see all
CREATE POLICY "Vendors view own location logs"
  ON public.vendor_location_logs FOR SELECT
  USING (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Insert by system (vendor or admin)
CREATE POLICY "Authenticated users insert location logs"
  ON public.vendor_location_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 5. Reverification requests table
CREATE TABLE IF NOT EXISTS public.vendor_reverification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  new_latitude DOUBLE PRECISION NOT NULL,
  new_longitude DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vendor_reverification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors view own reverification requests"
  ON public.vendor_reverification_requests FOR SELECT
  USING (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Vendors create reverification requests"
  ON public.vendor_reverification_requests FOR INSERT
  WITH CHECK (
    vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins update reverification requests"
  ON public.vendor_reverification_requests FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 6. Storage bucket for verification documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-verification-docs', 'vendor-verification-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: vendors upload to their own folder, admins can read all
CREATE POLICY "Vendors upload own verification docs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'vendor-verification-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Vendors view own verification docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'vendor-verification-docs'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    )
  );

-- 7. Enable realtime for location logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_location_logs;
