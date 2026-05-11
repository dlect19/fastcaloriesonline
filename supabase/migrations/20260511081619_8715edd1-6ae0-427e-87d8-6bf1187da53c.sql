CREATE OR REPLACE FUNCTION public.admin_get_user_emails(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT u.id AS user_id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY(p_user_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) TO authenticated;