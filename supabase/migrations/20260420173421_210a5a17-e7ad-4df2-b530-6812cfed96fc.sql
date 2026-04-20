CREATE OR REPLACE FUNCTION public.get_rider_delivery_count(_rider_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.orders
  WHERE rider_id = _rider_id AND status = 'delivered';
$$;

GRANT EXECUTE ON FUNCTION public.get_rider_delivery_count(uuid) TO authenticated, anon;