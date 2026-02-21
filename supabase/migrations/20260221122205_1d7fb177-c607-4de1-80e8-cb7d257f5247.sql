
-- Update owns_vendor to also grant access to active vendor staff
CREATE OR REPLACE FUNCTION public.owns_vendor(_user_id uuid, _vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vendors
    WHERE id = _vendor_id
      AND user_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.vendor_staff
    WHERE vendor_id = _vendor_id
      AND user_id = _user_id
      AND is_active = true
  )
$$;
