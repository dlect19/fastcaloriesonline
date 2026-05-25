
CREATE OR REPLACE FUNCTION public.lookup_pos_wallet_customer(_phone_variants text[])
RETURNS TABLE (user_id uuid, full_name text, phone text, wallet_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _is_vendor boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.user_id = auth.uid()
    UNION
    SELECT 1 FROM public.vendor_staff vs WHERE vs.user_id = auth.uid() AND vs.is_active = true
  ) INTO _is_vendor;

  IF NOT _is_vendor THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.full_name, p.phone, COALESCE(w.balance, 0)::numeric
  FROM public.profiles p
  LEFT JOIN public.wallets w ON w.user_id = p.user_id
  WHERE p.phone = ANY(_phone_variants)
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_pos_wallet_customer(text[]) TO authenticated;
