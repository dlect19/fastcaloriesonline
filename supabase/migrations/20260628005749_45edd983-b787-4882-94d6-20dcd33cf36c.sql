
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.delivery_companies ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);
ALTER TABLE public.delivery_companies ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);
ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES auth.users(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_vendors_verified_by ON public.vendors(verified_by);
CREATE INDEX IF NOT EXISTS idx_rider_profiles_verified_by ON public.rider_profiles(verified_by);
CREATE INDEX IF NOT EXISTS idx_delivery_companies_verified_by ON public.delivery_companies(verified_by);
CREATE INDEX IF NOT EXISTS idx_disputes_resolved_by ON public.disputes(resolved_by);
