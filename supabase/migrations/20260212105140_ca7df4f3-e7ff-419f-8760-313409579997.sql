
-- Create a public-safe view of rider_profiles that EXCLUDES sensitive PII
-- (NIN number, ID document URL, precise location when not needed)
CREATE OR REPLACE VIEW public.rider_profiles_safe
WITH (security_invoker = on) AS
SELECT 
  id,
  user_id,
  email,
  vehicle_type,
  vehicle_plate,
  is_online,
  is_verified,
  is_test_rider,
  is_email_verified,
  nin_verified,  -- boolean only, NOT the actual NIN number
  rating,
  total_deliveries,
  preferred_city,
  preferred_state,
  preferred_latitude,
  preferred_longitude,
  work_radius_km,
  affiliated_vendor_id,
  delivery_company_id,
  current_latitude,
  current_longitude,
  created_at,
  updated_at
FROM public.rider_profiles;
-- EXCLUDED: nin_number, nin_submitted_at, id_document_url

-- Add SELECT policy so delivery companies can view their riders' BASIC info
-- (they'll query via the safe view, but RLS applies on base table)
CREATE POLICY "Delivery companies can view own riders"
ON public.rider_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.delivery_companies dc
    WHERE dc.id = rider_profiles.delivery_company_id
      AND dc.user_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.delivery_company_staff dcs
    WHERE dcs.delivery_company_id = rider_profiles.delivery_company_id
      AND dcs.user_id = auth.uid()
      AND dcs.is_active = true
  )
);

-- Add SELECT policy so vendors can see riders assigned to their orders
CREATE POLICY "Vendors can view assigned rider profiles"
ON public.rider_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.rider_id = rider_profiles.user_id
      AND owns_vendor(auth.uid(), o.vendor_id)
  )
  OR
  EXISTS (
    SELECT 1 FROM public.vendor_riders vr
    WHERE vr.rider_profile_id = rider_profiles.id
      AND owns_vendor(auth.uid(), vr.vendor_id)
  )
);
