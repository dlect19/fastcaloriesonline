
-- Auto-log delivery distance when an order transitions to 'delivered'
CREATE OR REPLACE FUNCTION public.auto_log_delivery_distance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin_lat numeric;
  v_origin_lng numeric;
  v_dest_lat numeric;
  v_dest_lng numeric;
  v_distance numeric;
  v_env text;
BEGIN
  IF NEW.status <> 'delivered' OR COALESCE(OLD.status,'') = 'delivered' THEN
    RETURN NEW;
  END IF;
  IF NEW.rider_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- skip if already logged
  IF EXISTS (SELECT 1 FROM public.rider_distance_logs WHERE order_id = NEW.id AND rider_user_id = NEW.rider_id) THEN
    RETURN NEW;
  END IF;

  -- Source 1: dispatch_requests coords
  SELECT vendor_latitude, vendor_longitude, customer_latitude, customer_longitude
    INTO v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng
  FROM public.dispatch_requests
  WHERE order_id = NEW.id
  LIMIT 1;

  -- Source 2: vendors + addresses fallback
  IF v_origin_lat IS NULL OR v_dest_lat IS NULL THEN
    SELECT v.latitude, v.longitude, a.latitude, a.longitude
      INTO v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng
    FROM public.orders o
    LEFT JOIN public.vendors v ON v.id = o.vendor_id
    LEFT JOIN public.addresses a ON a.id = o.delivery_address_id
    WHERE o.id = NEW.id;
  END IF;

  IF v_origin_lat IS NULL OR v_origin_lng IS NULL OR v_dest_lat IS NULL OR v_dest_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Haversine in km
  v_distance := 2 * 6371 * asin(sqrt(
    power(sin(radians((v_dest_lat - v_origin_lat) / 2)), 2)
    + cos(radians(v_origin_lat)) * cos(radians(v_dest_lat))
      * power(sin(radians((v_dest_lng - v_origin_lng) / 2)), 2)
  ));

  -- 500m proximity = 0km per project rule
  IF v_distance < 0.5 THEN
    v_distance := 0;
  END IF;

  SELECT value INTO v_env FROM public.platform_settings WHERE key = 'platform_environment' LIMIT 1;
  IF v_env IS NULL THEN v_env := 'development'; END IF;

  INSERT INTO public.rider_distance_logs (rider_user_id, order_id, distance_km, environment)
  VALUES (NEW.rider_id, NEW.id, round(v_distance::numeric, 1), v_env);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block delivery on logging failure
  RAISE WARNING 'auto_log_delivery_distance failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_log_delivery_distance ON public.orders;
CREATE TRIGGER trg_auto_log_delivery_distance
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'delivered')
EXECUTE FUNCTION public.auto_log_delivery_distance();

-- Backfill historical delivered orders missing distance logs
WITH targets AS (
  SELECT o.id AS order_id, o.rider_id,
    COALESCE(dr.vendor_latitude, v.latitude) AS o_lat,
    COALESCE(dr.vendor_longitude, v.longitude) AS o_lng,
    COALESCE(dr.customer_latitude, a.latitude) AS d_lat,
    COALESCE(dr.customer_longitude, a.longitude) AS d_lng
  FROM public.orders o
  LEFT JOIN public.dispatch_requests dr ON dr.order_id = o.id
  LEFT JOIN public.vendors v ON v.id = o.vendor_id
  LEFT JOIN public.addresses a ON a.id = o.delivery_address_id
  WHERE o.status = 'delivered'
    AND o.rider_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.rider_distance_logs r
      WHERE r.order_id = o.id AND r.rider_user_id = o.rider_id
    )
)
INSERT INTO public.rider_distance_logs (rider_user_id, order_id, distance_km, environment)
SELECT t.rider_id, t.order_id,
  GREATEST(0, round((CASE
    WHEN (2 * 6371 * asin(sqrt(
      power(sin(radians((t.d_lat - t.o_lat) / 2)), 2)
      + cos(radians(t.o_lat)) * cos(radians(t.d_lat))
        * power(sin(radians((t.d_lng - t.o_lng) / 2)), 2)
    ))) < 0.5 THEN 0
    ELSE (2 * 6371 * asin(sqrt(
      power(sin(radians((t.d_lat - t.o_lat) / 2)), 2)
      + cos(radians(t.o_lat)) * cos(radians(t.d_lat))
        * power(sin(radians((t.d_lng - t.o_lng) / 2)), 2)
    )))
  END)::numeric, 1)),
  COALESCE((SELECT value FROM public.platform_settings WHERE key='platform_environment' LIMIT 1), 'development')
FROM targets t
WHERE t.o_lat IS NOT NULL AND t.o_lng IS NOT NULL AND t.d_lat IS NOT NULL AND t.d_lng IS NOT NULL;
