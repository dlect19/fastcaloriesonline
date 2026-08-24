ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS offline_sale_id text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_offline_sale_id_key ON public.orders(offline_sale_id) WHERE offline_sale_id IS NOT NULL;

ALTER TABLE public.pos_sessions ADD COLUMN IF NOT EXISTS local_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS pos_sessions_local_session_id_key ON public.pos_sessions(local_session_id) WHERE local_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pos_can_use(_user uuid, _vendor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor AND v.user_id = _user)
      OR EXISTS (
        SELECT 1 FROM public.vendor_staff s
         WHERE s.vendor_id = _vendor
           AND s.user_id = _user
           AND s.is_active = true
           AND (
             s.role IN ('owner','manager','cashier')
             OR (s.permissions IS NOT NULL AND 'use_pos' = ANY(s.permissions))
           )
      );
$$;

GRANT EXECUTE ON FUNCTION public.pos_can_use(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_pos_offline_session(
  _local_session_id text,
  _vendor_id uuid,
  _outlet_id uuid,
  _opening_cash numeric,
  _opened_at timestamptz,
  _cashier_name text,
  _closing_cash numeric DEFAULT NULL,
  _closed_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.pos_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','not_authenticated');
  END IF;
  IF NOT public.pos_can_use(v_uid, _vendor_id) THEN
    RETURN jsonb_build_object('status','rejected','reason','permission_revoked');
  END IF;

  SELECT * INTO v_session FROM public.pos_sessions WHERE local_session_id = _local_session_id;

  IF v_session.id IS NULL THEN
    INSERT INTO public.pos_sessions (
      vendor_id, outlet_id, cashier_id, cashier_name, opening_cash,
      opened_at, status, local_session_id
    ) VALUES (
      _vendor_id, _outlet_id, v_uid, _cashier_name, COALESCE(_opening_cash, 0),
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
$$;

GRANT EXECUTE ON FUNCTION public.sync_pos_offline_session(text, uuid, uuid, numeric, timestamptz, text, numeric, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_pos_offline_sale(
  _offline_sale_id text,
  _order jsonb,
  _items jsonb,
  _local_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vendor uuid := (_order->>'vendor_id')::uuid;
  v_existing uuid;
  v_session_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_amount numeric := COALESCE((_order->>'total')::numeric, 0);
  v_method text := COALESCE(_order->>'pos_payment_method', _order->>'payment_method', 'cash');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','not_authenticated');
  END IF;
  IF _offline_sale_id IS NULL OR length(_offline_sale_id) < 8 THEN
    RETURN jsonb_build_object('status','rejected','reason','missing_idempotency_key');
  END IF;
  IF NOT public.pos_can_use(v_uid, v_vendor) THEN
    RETURN jsonb_build_object('status','rejected','reason','permission_revoked');
  END IF;

  SELECT id INTO v_existing FROM public.orders WHERE offline_sale_id = _offline_sale_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicate','order_id', v_existing);
  END IF;

  IF _local_session_id IS NOT NULL THEN
    SELECT id INTO v_session_id FROM public.pos_sessions WHERE local_session_id = _local_session_id;
  END IF;
  IF v_session_id IS NULL AND (_order->>'pos_session_id') IS NOT NULL
     AND (_order->>'pos_session_id') ~ '^[0-9a-f-]{36}$' THEN
    SELECT id INTO v_session_id FROM public.pos_sessions WHERE id = (_order->>'pos_session_id')::uuid;
  END IF;

  -- Insert unpaid/pending first so stock + accounting triggers fire only after
  -- the items exist (single atomic transaction).
  INSERT INTO public.orders (
    order_number, vendor_id, outlet_id, user_id, subtotal, delivery_fee, service_fee,
    total, status, payment_status, payment_method, delivery_type, delivery_address_text,
    channel, pos_cashier_id, pos_payment_method, pos_session_id, delivery_instructions,
    offline_sale_id, created_at
  ) VALUES (
    COALESCE(_order->>'order_number', 'POS-' || upper(substr(md5(_offline_sale_id), 1, 8))),
    v_vendor,
    NULLIF(_order->>'outlet_id','')::uuid,
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
    COALESCE(NULLIF(_order->>'pos_cashier_id','')::uuid, v_uid),
    v_method,
    v_session_id,
    _order->>'delivery_instructions',
    _offline_sale_id,
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
      COALESCE((v_item->>'quantity')::int, 1),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'total_price')::numeric, 0),
      v_item->>'product_name',
      COALESCE(v_item->>'purchase_unit','pack'),
      COALESCE((v_item->>'unit_multiplier')::numeric, 1),
      v_item->>'special_instructions'
    );
  END LOOP;

  -- Now flip to the real POS state: fires stock decrement + vendor accounting once.
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

  RETURN jsonb_build_object('status','ok','order_id', v_order_id, 'session_id', v_session_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_pos_offline_sale(text, jsonb, jsonb, text) TO authenticated;