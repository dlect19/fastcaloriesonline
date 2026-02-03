-- Add email column to rider_profiles for vendor visibility
ALTER TABLE public.rider_profiles
ADD COLUMN email text;

-- Create index for email lookups
CREATE INDEX idx_rider_profiles_email ON public.rider_profiles(email);

-- Update existing rider_profiles with email from email_verification_otps where available
UPDATE public.rider_profiles rp
SET email = (
  SELECT evo.email 
  FROM public.email_verification_otps evo 
  WHERE evo.user_id = rp.user_id 
    AND evo.platform = 'rider'
  ORDER BY evo.created_at DESC
  LIMIT 1
)
WHERE rp.email IS NULL;