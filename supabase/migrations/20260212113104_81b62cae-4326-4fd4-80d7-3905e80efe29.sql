-- Fix infinite recursion: vendor_riders SELECT policy references rider_profiles,
-- and rider_profiles SELECT policy references vendor_riders.
-- Replace the vendor_riders "Riders can view their affiliations" policy to use user_id directly.

DROP POLICY IF EXISTS "Riders can view their affiliations" ON public.vendor_riders;

-- Create a security definer function to look up rider_profile_id by user_id
-- without triggering RLS on rider_profiles
CREATE OR REPLACE FUNCTION public.get_rider_profile_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.rider_profiles WHERE user_id = _user_id LIMIT 1
$$;

CREATE POLICY "Riders can view their affiliations"
ON public.vendor_riders
FOR SELECT
USING (rider_profile_id = public.get_rider_profile_id(auth.uid()));
