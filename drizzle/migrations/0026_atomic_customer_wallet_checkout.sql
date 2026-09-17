CREATE OR REPLACE FUNCTION public.checkout_customer_wallet(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
 uid uuid := auth.uid();
 result jsonb;
 paid jsonb;
 o public.orders;
 env text;
 code text;
BEGIN
 IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 BEGIN
   result := public.create_customer_order(p_payload);
   -- Validation rejection contains no order writes; preserve its diagnostics.
   IF result->>'ok'='false' THEN RETURN result; END IF;
   SELECT * INTO o FROM public.orders WHERE id=(result->>'order_id')::uuid FOR UPDATE;
   IF o.id IS NULL OR o.user_id IS DISTINCT FROM uid OR o.channel IS DISTINCT FROM 'online'
      OR o.duplicate_of_order_id IS NOT NULL OR o.status='cancelled' THEN
     RAISE EXCEPTION 'ORDER_NOT_PAYABLE';
   END IF;
   IF o.payment_status='paid' THEN
     RETURN result || jsonb_build_object('ok',true,'payment_status','paid','resumed',true);
   END IF;
   SELECT value INTO env FROM public.platform_settings WHERE key='platform_environment';
   IF env IS NULL OR env NOT IN ('production','development') THEN RAISE EXCEPTION 'ENVIRONMENT_UNAVAILABLE'; END IF;
   IF o.total<=0 THEN RAISE EXCEPTION 'ZERO_TOTAL_REQUIRES_SEPARATE_FLOW'; END IF;
   PERFORM set_config('app.authoritative_checkout','true',true);
   UPDATE public.orders SET environment=env WHERE id=o.id;
   paid := public.pay_orders_with_wallet(ARRAY[o.id], 'WP-'||o.id::text, env);
   IF paid->>'success' IS DISTINCT FROM 'true' OR NOT EXISTS(
      SELECT 1 FROM public.orders WHERE id=o.id AND payment_status='paid') THEN
     RAISE EXCEPTION 'WALLET_PAYMENT_FAILED';
   END IF;
 EXCEPTION WHEN OTHERS THEN
   code := CASE WHEN SQLERRM LIKE 'INSUFFICIENT_BALANCE%' THEN 'INSUFFICIENT_BALANCE'
     WHEN SQLERRM LIKE 'WALLET_DISABLED%' THEN 'WALLET_DISABLED'
     WHEN SQLERRM LIKE 'WALLET_NOT_FOUND%' THEN 'WALLET_NOT_FOUND'
     ELSE 'WALLET_CHECKOUT_REJECTED' END;
 END;
 IF code IS NOT NULL THEN
   PERFORM public.log_checkout_integrity_event('wallet_checkout_rejected',uid,
     p_attempt_key=>left(p_payload->>'checkout_attempt_key',200),p_detail=>code);
   RETURN jsonb_build_object('ok',false,'error',code);
 END IF;
 RETURN result || jsonb_build_object('ok',true,'payment_status','paid');
END;
$$;
REVOKE ALL ON FUNCTION public.checkout_customer_wallet(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_customer_wallet(jsonb) TO authenticated, service_role;
