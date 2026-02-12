
-- Drop and recreate the function with consistent parameter names
DROP FUNCTION IF EXISTS public.get_delivery_company_staff_role(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_delivery_company_staff_role(_user_id UUID, _company_id UUID)
RETURNS delivery_company_staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.delivery_company_staff
  WHERE user_id = _user_id
  AND delivery_company_id = _company_id
  AND is_active = true
  LIMIT 1;
$$;
