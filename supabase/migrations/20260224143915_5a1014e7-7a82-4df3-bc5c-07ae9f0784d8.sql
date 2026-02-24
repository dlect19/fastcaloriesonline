
CREATE OR REPLACE FUNCTION public.resolve_commission_rate(p_entity_type text, p_entity_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_override RECORD;
  v_default_rate NUMERIC;
  v_default_key TEXT;
BEGIN
  -- Check for personal override first
  SELECT * INTO v_override FROM commission_overrides
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  IF FOUND THEN
    IF v_override.commission_type = 'percentage' THEN
      RETURN COALESCE(v_override.percentage_value, 15);
    ELSIF v_override.commission_type = 'fixed' THEN
      RETURN COALESCE(v_override.fixed_value, 0);
    ELSIF v_override.commission_type = 'hybrid' THEN
      RETURN COALESCE(v_override.percentage_value, 15);
    END IF;
  END IF;

  -- Fall back to global default
  IF p_entity_type = 'vendor' THEN
    v_default_key := 'default_vendor_commission_rate';
  ELSIF p_entity_type IN ('rider', 'logistics') THEN
    -- Unified: all rider/delivery types use the same commission rate
    v_default_key := 'rider_platform_fee_pct';
  ELSE
    RETURN 15;
  END IF;

  SELECT value::NUMERIC INTO v_default_rate FROM platform_settings WHERE key = v_default_key;
  RETURN COALESCE(v_default_rate, 15);
END;
$function$;
