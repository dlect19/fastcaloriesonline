
-- Add setting for vendors to control whether their affiliated riders can accept external jobs
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS allow_rider_external_jobs boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendors.allow_rider_external_jobs IS 'Whether affiliated riders can be visible to and accept jobs from other vendors';
