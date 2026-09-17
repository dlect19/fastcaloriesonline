DO $patch$
DECLARE d text; a integer; b integer;
BEGIN
 SELECT pg_get_functiondef('public.create_customer_order(jsonb)'::regprocedure) INTO d;
 IF position('create_customer_order_worker' IN d)>0 THEN RAISE EXCEPTION 'Already wrapped'; END IF;
 d := replace(d,'public.create_customer_order(', 'public.create_customer_order_worker(');
 a := position('  IF v_existing.id IS NULL AND v_fingerprint IS NOT NULL THEN' IN d);
 b := position('  IF v_existing.id IS NOT NULL THEN' IN d);
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Unexpected checkout implementation'; END IF;
 d := substr(d,1,a-1)||substr(d,b); EXECUTE d;
 SELECT pg_get_functiondef('public.enforce_checkout_integrity()'::regprocedure) INTO d;
 a := position('  -- Exactly one live order per checkout fingerprint' IN d);
 b := position('  IF NEW.delivery_type = ''delivery'' THEN' IN d);
 IF a=0 OR b<=a OR position('FOR UPDATE' IN d)=0 THEN RAISE EXCEPTION 'Unexpected integrity guard'; END IF;
 d := substr(d,1,a-1)||substr(d,b); EXECUTE d;
END;
$patch$;
REVOKE ALL ON FUNCTION public.create_customer_order_worker(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.create_customer_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
 uid uuid := auth.uid();
 k text := nullif(btrim(p_payload->>'checkout_attempt_key'),'');
 existing public.orders; near_order uuid; result jsonb; code text;
 vendor uuid; outlet uuid; quote_id uuid; q public.delivery_quotes;
BEGIN
 IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 IF k IS NULL OR length(k)>200 THEN
 PERFORM public.log_checkout_integrity_event('invalid_checkout_attempt',uid,p_detail=>'Missing or oversized checkout attempt key');
 RETURN jsonb_build_object('ok',false,'error','CHECKOUT_ATTEMPT_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-checkout:'||k,0));
 SELECT * INTO existing FROM public.orders WHERE checkout_attempt_key=k LIMIT 1;
 IF existing.id IS NOT NULL THEN
 IF existing.user_id IS DISTINCT FROM uid THEN
 PERFORM public.log_checkout_integrity_event('checkout_attempt_conflict',uid,p_attempt_key=>k,p_detail=>'Attempt key unavailable');
 RETURN jsonb_build_object('ok',false,'error','CHECKOUT_ATTEMPT_CONFLICT'); END IF;
 PERFORM public.log_checkout_integrity_event('checkout_replay',uid,existing.vendor_id,existing.outlet_id,existing.id,existing.id,k,existing.delivery_quote_id,p_detail=>'Same key resumed; no new order');
 RETURN jsonb_build_object('ok',true,'order_id',existing.id,'order_number',existing.order_number,'resumed',true,'total',existing.total,'delivery_fee',existing.delivery_fee,'service_fee',existing.service_fee,'discount',existing.discount,'payment_status',existing.payment_status);
 END IF;
 BEGIN
 vendor := (p_payload->>'vendor_id')::uuid;
 outlet := nullif(p_payload->>'outlet_id','')::uuid;
 quote_id := nullif(p_payload->>'delivery_quote_id','')::uuid;
 SELECT id INTO near_order FROM public.orders WHERE user_id=uid AND vendor_id=vendor AND outlet_id IS NOT DISTINCT FROM outlet AND channel='online' AND created_at>now()-interval '120 seconds' AND checkout_fingerprint IS NOT DISTINCT FROM nullif(p_payload->>'checkout_fingerprint','') AND delivery_type=COALESCE(p_payload->>'delivery_type','delivery') ORDER BY created_at DESC LIMIT 1;
 IF COALESCE(p_payload->>'delivery_type','delivery')='delivery' THEN
 IF quote_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_QUOTE_REQUIRED'; END IF;
 SELECT * INTO q FROM public.delivery_quotes WHERE id=quote_id FOR UPDATE;
 IF q.id IS NULL OR q.user_id IS DISTINCT FROM uid OR q.vendor_id IS DISTINCT FROM vendor OR q.outlet_id IS DISTINCT FROM outlet THEN RAISE EXCEPTION 'DELIVERY_QUOTE_MISMATCH'; END IF;
 IF q.consumed_order_id IS NOT NULL THEN RAISE EXCEPTION 'DELIVERY_QUOTE_CONSUMED'; END IF;
 IF q.expires_at<=now() THEN RAISE EXCEPTION 'DELIVERY_QUOTE_STALE'; END IF;
 IF (q.checkout_fingerprint IS NOT NULL AND q.checkout_fingerprint IS DISTINCT FROM nullif(p_payload->>'checkout_fingerprint','')) OR q.dest_lat IS DISTINCT FROM (p_payload->>'delivery_latitude')::numeric OR q.dest_lng IS DISTINCT FROM (p_payload->>'delivery_longitude')::numeric OR (q.customer_address_id IS NOT NULL AND q.customer_address_id IS DISTINCT FROM nullif(p_payload->>'delivery_address_id','')::uuid) THEN RAISE EXCEPTION 'DELIVERY_QUOTE_MISMATCH'; END IF;
 END IF;
 result := public.create_customer_order_worker(jsonb_set(p_payload,'{checkout_attempt_key}',to_jsonb(k)));
 EXCEPTION WHEN OTHERS THEN
 code := CASE WHEN SQLERRM LIKE 'PRICING_CHANGED%' THEN 'PRICING_CHANGED' WHEN SQLERRM LIKE 'DELIVERY_QUOTE_%' THEN split_part(SQLERRM,':',1) WHEN SQLERRM LIKE 'DELIVERY_FEE_MISMATCH%' THEN 'DELIVERY_FEE_MISMATCH' ELSE 'CHECKOUT_REJECTED' END;
 END;
 IF near_order IS NOT NULL THEN
 PERFORM public.log_checkout_integrity_event('suspicious_near_duplicate',uid,vendor,outlet,NULL,near_order,k,quote_id,p_detail=>'Similar recent checkout; new key is permitted'); END IF;
 IF code IS NOT NULL THEN
 PERFORM public.log_checkout_integrity_event(lower(code),uid,vendor,outlet,NULL,NULL,k,quote_id,p_detail=>code);
 RETURN jsonb_build_object('ok',false,'error',code); END IF;
 RETURN result || jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_order(jsonb) TO authenticated, service_role;