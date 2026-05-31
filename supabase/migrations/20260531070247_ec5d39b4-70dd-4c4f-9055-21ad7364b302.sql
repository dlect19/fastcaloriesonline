DROP FUNCTION IF EXISTS public.debug_wallet_payment_flow(uuid);

CREATE OR REPLACE FUNCTION public.vendor_settlement_release_at(
  p_earned_at timestamptz DEFAULT now(),
  p_wallet_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timing text;
  v_category text;
  v_hours numeric := 0;
BEGIN
  SELECT lower(COALESCE(v.category::text, vo.store_type::text, 'restaurant'))
  INTO v_category
  FROM public.wallets w
  LEFT JOIN public.vendors v ON v.user_id = w.user_id
  LEFT JOIN public.vendor_outlets vo ON vo.id = w.outlet_id
  WHERE w.id = p_wallet_id
  LIMIT 1;

  v_category := CASE
    WHEN v_category LIKE '%pharm%' THEN 'pharmacy'
    WHEN v_category LIKE '%market%' OR v_category LIKE '%grocery%' THEN 'market'
    ELSE 'restaurant'
  END;

  SELECT value INTO v_timing
  FROM public.platform_settings
  WHERE key = 'vendor_settlement_mode_' || v_category
  LIMIT 1;

  IF v_timing IS NULL THEN
    SELECT COALESCE(value, 'instant') INTO v_timing
    FROM public.platform_settings
    WHERE key = 'vendor_settlement_timing'
    LIMIT 1;
  END IF;

  v_timing := COALESCE(v_timing, 'instant');

  IF v_timing = 'next_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day';
  ELSIF v_timing = 'third_day' THEN
    RETURN date_trunc('day', p_earned_at AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos' + INTERVAL '3 days';
  ELSIF v_timing = 'hours' THEN
    SELECT COALESCE(NULLIF(value, '')::numeric, 0) INTO v_hours
    FROM public.platform_settings
    WHERE key = 'settlement_hours_' || v_category
    LIMIT 1;

    RETURN p_earned_at + (COALESCE(v_hours, 0) * INTERVAL '1 hour');
  END IF;

  RETURN p_earned_at;
END;
$$;