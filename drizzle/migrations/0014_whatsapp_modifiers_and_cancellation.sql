-- 1) Extend the atomic WhatsApp checkout so order items carry their vendor-configured
--    modifiers (add-ons, portion) exactly like web/app orders. Fully backward
--    compatible: items without these keys behave as before.
CREATE OR REPLACE FUNCTION public.whatsapp_create_order_atomic(
  p_checkout_id uuid, p_order jsonb, p_items jsonb,
  p_wallet_debit boolean DEFAULT false, p_environment text DEFAULT 'production'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cols text;
  v_sql text;
  v_order_id uuid;
  v_order_number text;
  v_total numeric;
  v_user_id uuid;
  v_wallet_id uuid;
  v_balance numeric;
  v_is_test boolean := (p_environment = 'development');
  v_existing uuid;
  v_item jsonb;
  v_item_id uuid;
BEGIN
  IF p_checkout_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_create_order_atomic: p_checkout_id is required';
  END IF;

  SELECT order_id INTO v_existing
  FROM public.whatsapp_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_create_order_atomic: checkout % not found', p_checkout_id;
  END IF;

  IF v_existing IS NOT NULL THEN
    SELECT order_number, total INTO v_order_number, v_total
    FROM public.orders WHERE id = v_existing;
    RETURN jsonb_build_object(
      'order_id', v_existing, 'order_number', v_order_number,
      'total', v_total, 'already_created', true
    );
  END IF;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
    INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'orders'
    AND c.column_name IN (SELECT jsonb_object_keys(p_order))
    AND c.is_generated = 'NEVER';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'whatsapp_create_order_atomic: no valid order columns supplied';
  END IF;

  v_sql := format(
    'INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(NULL::public.orders, $1) RETURNING id, order_number, total, user_id',
    v_cols, v_cols
  );
  EXECUTE v_sql USING p_order INTO v_order_id, v_order_number, v_total, v_user_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.order_items (
      order_id, product_id, product_name, quantity, unit_price, total_price, calories,
      special_instructions, portion_label, portion_size, portion_unit
    ) VALUES (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total_price')::numeric,
      COALESCE((v_item->>'calories')::numeric, 0),
      NULLIF(v_item->>'special_instructions', ''),
      NULLIF(v_item->>'portion_label', ''),
      NULLIF(v_item->>'portion_size', '')::numeric,
      NULLIF(v_item->>'portion_unit', '')
    )
    RETURNING id INTO v_item_id;

    IF jsonb_typeof(v_item->'addons') = 'array' THEN
      INSERT INTO public.order_item_addons (
        order_item_id, addon_group_name, addon_item_name, additional_price, calories
      )
      SELECT v_item_id,
             a->>'group_name',
             a->>'item_name',
             COALESCE((a->>'price')::numeric, 0),
             COALESCE((a->>'calories')::numeric, 0)
      FROM jsonb_array_elements(v_item->'addons') a;
    END IF;
  END LOOP;

  IF p_wallet_debit THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'whatsapp_create_order_atomic: wallet payment requires user_id';
    END IF;

    SELECT id,
           CASE WHEN v_is_test THEN COALESCE(test_balance, 0) ELSE COALESCE(balance, 0) END
      INTO v_wallet_id, v_balance
    FROM public.wallets
    WHERE user_id = v_user_id AND wallet_type = 'customer'
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'whatsapp_create_order_atomic: customer wallet not found';
    END IF;
    IF v_balance < v_total THEN
      RAISE EXCEPTION 'whatsapp_create_order_atomic: insufficient wallet balance (% < %)', v_balance, v_total;
    END IF;

    PERFORM public.post_wallet_entry(
      p_wallet_id := v_wallet_id,
      p_wallet_type := 'customer',
      p_transaction_type := 'debit',
      p_category := 'wallet_payment',
      p_amount := v_total,
      p_reference := 'WA-' || v_order_number,
      p_environment := p_environment,
      p_order_id := v_order_id,
      p_notes := 'WhatsApp order #' || v_order_number,
      p_metadata := jsonb_build_object('source', 'whatsapp-agent', 'order_number', v_order_number)
    );
  END IF;

  UPDATE public.whatsapp_checkouts
  SET order_id = v_order_id,
      status = CASE WHEN p_wallet_debit THEN 'paid' ELSE 'awaiting_payment' END,
      updated_at = now()
  WHERE id = p_checkout_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'order_number', v_order_number,
    'total', v_total, 'already_created', false
  );
END;
$function$;

-- 2) Server-authoritative, idempotent cancellation of a pending WhatsApp order.
--    Paid orders are NEVER auto-cancelled here; they follow the refund policy.
CREATE OR REPLACE FUNCTION public.whatsapp_cancel_pending_order(
  p_user_id uuid, p_order_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.user_id = p_user_id
    AND (p_order_number IS NULL OR o.order_number = replace(p_order_number, '#', ''))
    AND (p_order_number IS NOT NULL OR o.created_at > now() - interval '7 days')
  ORDER BY (o.channel = 'whatsapp') DESC, o.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_orders');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_cancelled', true,
      'order_number', v_order.order_number, 'status', 'cancelled',
      'payment_status', v_order.payment_status);
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'already_paid',
      'order_number', v_order.order_number, 'status', v_order.status,
      'payment_status', v_order.payment_status, 'total', v_order.total);
  END IF;

  -- Same window the app enforces for customer-initiated cancellation.
  IF v_order.status NOT IN ('pending', 'confirmed') THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'not_cancellable',
      'order_number', v_order.order_number, 'status', v_order.status,
      'payment_status', v_order.payment_status);
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      cancellation_reason = '[Customer] customer_cancelled_via_whatsapp',
      cancelled_at = now()
  WHERE id = v_order.id;

  -- Kill the checkout intent so the hosted payment link can never complete it.
  UPDATE public.whatsapp_checkouts
  SET status = 'cancelled', updated_at = now()
  WHERE (order_id = v_order.id
         OR (v_order.payment_reference IS NOT NULL AND payment_reference = v_order.payment_reference))
    AND status <> 'paid';

  RETURN jsonb_build_object(
    'ok', true, 'already_cancelled', false,
    'order_number', v_order.order_number, 'status', 'cancelled',
    'payment_reference', v_order.payment_reference, 'total', v_order.total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_cancel_pending_order(uuid, text) TO service_role;