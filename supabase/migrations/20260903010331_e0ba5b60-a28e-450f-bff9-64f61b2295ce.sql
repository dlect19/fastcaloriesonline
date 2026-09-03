CREATE OR REPLACE FUNCTION public.sync_pos_offline_sale(_offline_sale_id text, _order jsonb, _items jsonb, _local_session_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_vendor uuid := (_order->>'vendor_id')::uuid;
  v_existing uuid;
  v_session public.pos_sessions;
  v_session_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_outlet uuid := NULLIF(_order->>'outlet_id','')::uuid;
  v_amount numeric := COALESCE((_order->>'total')::numeric, 0);
  v_method text := COALESCE(_order->>'pos_payment_method', _order->>'payment_method', 'cash');
  v_qty numeric;
  v_mult numeric;
  v_conflicts jsonb := '[]'::jsonb;
  v_prod RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','not_authenticated');
  END IF;
  IF _offline_sale_id IS NULL OR length(_offline_sale_id) < 8 THEN
    RETURN jsonb_build_object('status','rejected','reason','missing_idempotency_key');
  END IF;
  IF v_vendor IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','missing_vendor');
  END IF;
  IF NOT public.pos_can_use(v_uid, v_vendor) THEN
    RETURN jsonb_build_object('status','rejected','reason','permission_revoked');
  END IF;

  SELECT id INTO v_existing FROM public.orders WHERE offline_sale_id = _offline_sale_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicate','order_id', v_existing);
  END IF;

  IF v_outlet IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vendor_outlets o WHERE o.id = v_outlet AND o.vendor_id = v_vendor
  ) THEN
    v_outlet := NULL;
  END IF;

  IF _local_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.pos_sessions WHERE local_session_id = _local_session_id;
  END IF;
  IF v_session.id IS NULL AND (_order->>'pos_session_id') IS NOT NULL
     AND (_order->>'pos_session_id') ~ '^[0-9a-f-]{36}$' THEN
    SELECT * INTO v_session FROM public.pos_sessions WHERE id = (_order->>'pos_session_id')::uuid;
  END IF;

  IF v_session.id IS NOT NULL THEN
    IF v_session.vendor_id <> v_vendor OR v_session.cashier_id <> v_uid THEN
      RETURN jsonb_build_object('status','rejected','reason','session_mismatch');
    END IF;
    v_session_id := v_session.id;
  END IF;

  -- Flag stock conflicts for manager review (the sale still lands: it happened in the real world)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    IF NULLIF(v_item->>'product_id','') IS NULL THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_mult := COALESCE((v_item->>'unit_multiplier')::numeric, 1);
    SELECT id, name, stock_quantity, track_stock INTO v_prod
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF v_prod.id IS NOT NULL AND COALESCE(v_prod.track_stock, false)
       AND COALESCE(v_prod.stock_quantity, 0) < (v_qty * v_mult) THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', v_prod.name,
        'needed', v_qty * v_mult,
        'available', COALESCE(v_prod.stock_quantity, 0)
      );
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    order_number, vendor_id, outlet_id, user_id, subtotal, delivery_fee, service_fee,
    total, status, payment_status, payment_method, delivery_type, delivery_address_text,
    channel, pos_cashier_id, pos_payment_method, pos_session_id, delivery_instructions,
    offline_sale_id, pos_payment_verification, created_at
  ) VALUES (
    COALESCE(_order->>'order_number', 'POS-' || upper(substr(md5(_offline_sale_id), 1, 8))),
    v_vendor,
    v_outlet,
    COALESCE(NULLIF(_order->>'user_id','')::uuid, v_uid),
    COALESCE((_order->>'subtotal')::numeric, v_amount),
    COALESCE((_order->>'delivery_fee')::numeric, 0),
    COALESCE((_order->>'service_fee')::numeric, 0),
    v_amount,
    'pending',
    'unpaid',
    COALESCE(_order->>'payment_method','cash'),
    COALESCE(_order->>'delivery_type','self_pickup'),
    COALESCE(_order->>'delivery_address_text','In-store POS'),
    'pos',
    v_uid,
    v_method,
    v_session_id,
    _order->>'delivery_instructions',
    _offline_sale_id,
    CASE WHEN v_method IN ('transfer','card') THEN 'manual_unverified' ELSE 'cash_offline' END,
    COALESCE(NULLIF(_order->>'created_at','')::timestamptz, now())
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.order_items (
      order_id, product_id, quantity, unit_price, total_price, product_name,
      purchase_unit, unit_multiplier, special_instructions, portion_unit
    ) VALUES (
      v_order_id,
      NULLIF(v_item->>'product_id','')::uuid,
      COALESCE((v_item->>'quantity')::numeric, 1),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'total_price')::numeric, 0),
      v_item->>'product_name',
      COALESCE(v_item->>'purchase_unit','pack'),
      COALESCE((v_item->>'unit_multiplier')::numeric, 1),
      v_item->>'special_instructions',
      COALESCE(NULLIF(v_item->>'portion_unit',''),'pack')
    );
  END LOOP;

  UPDATE public.orders
     SET status = COALESCE((_order->>'status')::order_status, 'delivered'::order_status),
         payment_status = COALESCE(_order->>'payment_status','paid')
   WHERE id = v_order_id;

  IF v_session_id IS NOT NULL THEN
    UPDATE public.pos_sessions
       SET total_sales = COALESCE(total_sales,0) + v_amount,
           total_orders = COALESCE(total_orders,0) + 1,
           cash_sales = COALESCE(cash_sales,0) + CASE WHEN v_method = 'cash' THEN v_amount ELSE 0 END,
           transfer_sales = COALESCE(transfer_sales,0) + CASE WHEN v_method = 'transfer' THEN v_amount ELSE 0 END,
           card_sales = COALESCE(card_sales,0) + CASE WHEN v_method = 'card' THEN v_amount ELSE 0 END,
           wallet_sales = COALESCE(wallet_sales,0) + CASE WHEN v_method = 'wallet' THEN v_amount ELSE 0 END
     WHERE id = v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'order_id', v_order_id,
    'session_id', v_session_id,
    'stock_conflicts', v_conflicts
  );
END;
$function$;