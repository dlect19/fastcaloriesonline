CREATE OR REPLACE FUNCTION public.debug_wallet_payment_flow(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error text;
BEGIN
  BEGIN
    UPDATE orders SET payment_status='paid', status='confirmed' WHERE id=p_order_id;
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLSTATE || ': ' || SQLERRM;
  END;
  RETURN v_error;
END;
$$;
GRANT EXECUTE ON FUNCTION public.debug_wallet_payment_flow TO service_role;