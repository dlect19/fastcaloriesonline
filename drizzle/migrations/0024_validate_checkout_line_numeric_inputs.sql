-- Pure validation used before authoritative price arithmetic. No row writes.
CREATE OR REPLACE FUNCTION public.validate_checkout_line_inputs(p_item jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE
  a jsonb;
  q numeric;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CART_ITEM';
  END IF;
  IF jsonb_typeof(p_item->'quantity') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  q := (p_item->>'quantity')::numeric;
  IF q <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF p_item ? 'addons' AND jsonb_typeof(p_item->'addons') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_OPTION';
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(p_item->'addons','[]'::jsonb)) LOOP
    IF jsonb_typeof(a) IS DISTINCT FROM 'object'
       OR COALESCE(NULLIF(a->>'addon_item_id',''),NULLIF(a->>'item_name','')) IS NULL THEN
      RAISE EXCEPTION 'INVALID_OPTION';
    END IF;
    IF a ? 'quantity' THEN
      IF jsonb_typeof(a->'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'INVALID_OPTION_QUANTITY';
      END IF;
      q := (a->>'quantity')::numeric;
      IF q <= 0 OR q <> floor(q) THEN
        RAISE EXCEPTION 'INVALID_OPTION_QUANTITY';
      END IF;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_checkout_line_inputs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_checkout_line_inputs(jsonb) TO authenticated, service_role;

DO $patch$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.price_checkout_line(uuid,uuid,jsonb)'::regprocedure) INTO d;
  IF position('BEGIN' IN d)=0 THEN RAISE EXCEPTION 'Unexpected pricing function'; END IF;
  IF position('PERFORM public.validate_checkout_line_inputs(p_item);' IN d)=0 THEN
    d := replace(d, 'BEGIN', 'BEGIN
  PERFORM public.validate_checkout_line_inputs(p_item);');
    EXECUTE d;
  END IF;
END;
$patch$;