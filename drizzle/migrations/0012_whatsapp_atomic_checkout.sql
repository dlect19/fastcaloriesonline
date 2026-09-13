-- Phase 7: transaction-safe WhatsApp checkout.
-- 1) Per-checkout-intent idempotency key on the durable cart (additive).
ALTER TABLE public.whatsapp_carts
  ADD COLUMN IF NOT EXISTS checkout_intent_key text;

-- 2) One RPC that creates the order, its items, and (for wallet payments) the
--    wallet debit inside a SINGLE transaction. Any failure rolls the whole
--    thing back, so a paid-but-undebited order can never survive.
CREATE OR REPLACE FUNCTION public.whatsapp_create_order_atomic(
  p_checkout_id uuid,
  p_order jsonb,
  p_items jsonb,
  p_wallet_debit boolean DEFAULT false,
  p_environment text DEFAULT 'production'
)
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
BEGIN
  IF p_checkout_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_create_order_atomic: p_checkout_id is required';
  END IF;

  -- Lock the checkout intent: concurrent retries serialise here.
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

  -- Insert only the keys the caller supplied that are real orders columns, so
  -- column defaults / triggers (order_number, timestamps) still apply.
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

  INSERT INTO public.order_items (
    order_id, product_id, product_name, quantity, unit_price, total_price, calories
  )
  SELECT v_order_id,
         (i->>'product_id')::uuid,
         i->>'product_name',
         (i->>'quantity')::integer,
         (i->>'unit_price')::numeric,
         (i->>'total_price')::numeric,
         COALESCE((i->>'calories')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i;

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

REVOKE ALL ON FUNCTION public.whatsapp_create_order_atomic(uuid, jsonb, jsonb, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_create_order_atomic(uuid, jsonb, jsonb, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_create_order_atomic(uuid, jsonb, jsonb, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_create_order_atomic(uuid, jsonb, jsonb, boolean, text) TO service_role;