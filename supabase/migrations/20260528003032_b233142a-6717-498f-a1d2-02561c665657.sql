CREATE OR REPLACE FUNCTION public.admin_get_entity_wallets(
  _user_id uuid,
  _wallet_type text
)
RETURNS TABLE(
  id uuid,
  balance numeric,
  test_balance numeric,
  eligible_balance numeric,
  test_eligible_balance numeric,
  outlet_id uuid,
  outlet_name text,
  is_disabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'::app_role
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    w.id,
    COALESCE(w.balance, 0)::numeric,
    COALESCE(w.test_balance, 0)::numeric,
    COALESCE(w.eligible_balance, 0)::numeric,
    COALESCE(w.test_eligible_balance, 0)::numeric,
    w.outlet_id,
    o.outlet_name,
    COALESCE(w.is_disabled, false)
  FROM public.wallets w
  LEFT JOIN public.vendor_outlets o ON o.id = w.outlet_id
  WHERE w.user_id = _user_id
    AND w.wallet_type = _wallet_type
  ORDER BY COALESCE(w.balance, 0) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_entity_wallets(uuid, text) TO authenticated;
