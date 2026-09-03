-- ============ 1. Decimal-safe quantities ============
ALTER TABLE public.order_items
  ALTER COLUMN quantity TYPE numeric(10,3),
  ALTER COLUMN unit_multiplier TYPE numeric(10,3);

ALTER TABLE public.stock_movements
  ALTER COLUMN quantity_change TYPE numeric(12,3),
  ALTER COLUMN quantity_before TYPE numeric(12,3),
  ALTER COLUMN quantity_after TYPE numeric(12,3);

ALTER TABLE public.products
  ALTER COLUMN stock_quantity TYPE numeric(12,3);

-- Offline manual payment verification marker
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pos_payment_verification text;

-- ============ 2. adjust_product_stock -> numeric ============
DROP FUNCTION IF EXISTS public.adjust_product_stock(uuid, integer, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id uuid,
  p_quantity_change numeric,
  p_movement_type text,
  p_reason text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_type text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_new_qty numeric;
  v_now_unavailable boolean := false;
BEGIN
  SELECT id, vendor_id, outlet_id, stock_quantity, track_stock, is_available, name
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  IF NOT COALESCE(v_product.track_stock, false) THEN
    RETURN jsonb_build_object('success', true, 'tracked', false);
  END IF;

  v_new_qty := round(COALESCE(v_product.stock_quantity, 0) + COALESCE(p_quantity_change, 0), 3);

  IF v_new_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient stock', 'available', COALESCE(v_product.stock_quantity, 0));
  END IF;

  IF v_new_qty = 0 AND v_product.is_available = true THEN
    v_now_unavailable := true;
  END IF;

  UPDATE public.products
  SET stock_quantity = v_new_qty,
      is_available = CASE WHEN v_new_qty = 0 THEN false
                          WHEN v_new_qty > 0 AND is_available = false AND p_quantity_change > 0 THEN true
                          ELSE is_available END,
      updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id, vendor_id, outlet_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, reference_id, reference_type, created_by
  ) VALUES (
    p_product_id, v_product.vendor_id, v_product.outlet_id, p_movement_type, p_quantity_change,
    COALESCE(v_product.stock_quantity, 0), v_new_qty, p_reason, p_reference_id, p_reference_type, auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tracked', true,
    'new_quantity', v_new_qty,
    'auto_marked_unavailable', v_now_unavailable
  );
END;
$function$;

-- ============ 3. POS permission check respects custom permissions ============
CREATE OR REPLACE FUNCTION public.pos_can_use(_user uuid, _vendor uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor AND v.user_id = _user)
      OR EXISTS (
        SELECT 1 FROM public.vendor_staff s
         WHERE s.vendor_id = _vendor
           AND s.user_id = _user
           AND s.is_active = true
           AND (
             CASE
               WHEN s.permissions IS NOT NULL AND array_length(s.permissions, 1) > 0
                 THEN 'use_pos' = ANY(s.permissions)
               ELSE s.role IN ('owner','manager','cashier')
             END
           )
      );
$function$;

-- ============ 4. Offline session sync: vendor/cashier/outlet validation ============
CREATE OR REPLACE FUNCTION public.sync_pos_offline_session(
  _local_session_id text,
  _vendor_id uuid,
  _outlet_id uuid,
  _opening_cash numeric,
  _opened_at timestamp with time zone,
  _cashier_name text,
  _closing_cash numeric DEFAULT NULL::numeric,
  _closed_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.pos_sessions;
  v_outlet uuid := _outlet_id;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','not_authenticated');
  END IF;
  IF _local_session_id IS NULL OR length(_local_session_id) < 8 THEN
    RETURN jsonb_build_object('status','rejected','reason','missing_local_session_id');
  END IF;
  IF NOT public.pos_can_use(v_uid, _vendor_id) THEN
    RETURN jsonb_build_object('status','rejected','reason','permission_revoked');
  END IF;

  -- the outlet must belong to this vendor, otherwise drop it
  IF v_outlet IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vendor_outlets o WHERE o.id = v_outlet AND o.vendor_id = _vendor_id
  ) THEN
    v_outlet := NULL;
  END IF;

  SELECT * INTO v_session FROM public.pos_sessions WHERE local_session_id = _local_session_id;

  IF v_session.id IS NOT NULL THEN
    IF v_session.vendor_id <> _vendor_id OR v_session.cashier_id <> v_uid THEN
      RETURN jsonb_build_object('status','rejected','reason','session_mismatch');
    END IF;
  ELSE
    INSERT INTO public.pos_sessions (
      vendor_id, outlet_id, cashier_id, cashier_name, opening_cash,
      opened_at, status, local_session_id
    ) VALUES (
      _vendor_id, v_outlet, v_uid, _cashier_name, COALESCE(_opening_cash, 0),
      COALESCE(_opened_at, now()), 'open', _local_session_id
    )
    RETURNING * INTO v_session;
  END IF;

  IF _closed_at IS NOT NULL AND v_session.status <> 'closed' THEN
    UPDATE public.pos_sessions
       SET closing_cash = _closing_cash,
           expected_cash = COALESCE(opening_cash,0) + COALESCE(cash_sales,0),
           cash_difference = COALESCE(_closing_cash,0) - (COALESCE(opening_cash,0) + COALESCE(cash_sales,0)),
           notes = COALESCE(_notes, notes),
           closed_at = _closed_at,
           status = 'closed'
     WHERE id = v_session.id
     RETURNING * INTO v_session;
  END IF;

  RETURN jsonb_build_object('status','ok','session_id', v_session.id, 'session_status', v_session.status);
END;
$function$;

-- ============ 5. Offline sale sync: decimal qty, server-side cashier, stock conflicts ============
CREATE OR REPLACE FUNCTION public.sync_pos_offline_sale(
  _offline_sale_id text,
  _order jsonb,
  _items jsonb,
  _local_session_id text DEFAULT NULL::text
)
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
      purchase_unit, unit_multiplier, special_instructions
    ) VALUES (
      v_order_id,
      NULLIF(v_item->>'product_id','')::uuid,
      COALESCE((v_item->>'quantity')::numeric, 1),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'total_price')::numeric, 0),
      v_item->>'product_name',
      COALESCE(v_item->>'purchase_unit','pack'),
      COALESCE((v_item->>'unit_multiplier')::numeric, 1),
      v_item->>'special_instructions'
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