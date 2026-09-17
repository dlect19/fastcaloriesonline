-- Serialize online quote consumption in the existing generic integrity guard.
-- No order, wallet, statistics, notification, or repair rows are changed.
DO $migration$
DECLARE
  definition text;
  original_select text := 'AND consumed_order_id IS NULL
        AND expires_at > now();';
BEGIN
  SELECT pg_get_functiondef('public.enforce_checkout_integrity()'::regprocedure)
    INTO definition;
  IF position(original_select IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected enforce_checkout_integrity definition; quote-lock patch aborted';
  END IF;
  definition := replace(definition, original_select,
    'AND consumed_order_id IS NULL
        AND expires_at > now()
      FOR UPDATE;');
  EXECUTE definition;
END;
$migration$;