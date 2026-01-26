-- Allow bicycle as a valid rider vehicle type
ALTER TABLE public.rider_profiles
  DROP CONSTRAINT IF EXISTS rider_profiles_vehicle_type_check;

ALTER TABLE public.rider_profiles
  ADD CONSTRAINT rider_profiles_vehicle_type_check
  CHECK (
    vehicle_type IS NULL
    OR vehicle_type IN ('bicycle', 'motorcycle', 'tricycle', 'car', 'van')
  );
