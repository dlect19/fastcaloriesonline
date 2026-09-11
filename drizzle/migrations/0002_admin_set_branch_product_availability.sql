CREATE OR REPLACE FUNCTION public.admin_set_branch_product_availability(
  _product_id uuid,
  _outlet_id uuid,
  _available boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _global boolean;
  _hidden boolean;
  _branch boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _outlet_id IS NULL THEN
    RAISE EXCEPTION 'A branch must be selected';
  END IF;

  PERFORM 1 FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF _available THEN
    -- Turning ON at a branch: the store-wide switch must be on (and the item
    -- not hidden), then the blocking branch override is removed.
    UPDATE public.products
       SET is_available = true,
           is_hidden = false
     WHERE id = _product_id;

    DELETE FROM public.outlet_product_overrides
     WHERE product_id = _product_id
       AND outlet_id = _outlet_id;
  ELSE
    -- Turning OFF at a branch only: store-wide state untouched.
    INSERT INTO public.outlet_product_overrides (outlet_id, product_id, is_available)
    VALUES (_outlet_id, _product_id, false)
    ON CONFLICT (outlet_id, product_id) DO UPDATE SET is_available = false;
  END IF;

  SELECT p.is_available, p.is_hidden INTO _global, _hidden
    FROM public.products p WHERE p.id = _product_id;

  SELECT o.is_available INTO _branch
    FROM public.outlet_product_overrides o
   WHERE o.product_id = _product_id AND o.outlet_id = _outlet_id;

  RETURN jsonb_build_object(
    'product_id', _product_id,
    'outlet_id', _outlet_id,
    'global_available', _global,
    'is_hidden', _hidden,
    'branch_override', _branch,
    'effective_available', public.product_effective_available(_product_id, _outlet_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_branch_product_availability(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_branch_product_availability(uuid, uuid, boolean) TO authenticated;
