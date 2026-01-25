-- Create a function to allow users to add vendor role to their own account
CREATE OR REPLACE FUNCTION public.add_vendor_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Add vendor role if not already present
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'vendor')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.add_vendor_role() TO authenticated;