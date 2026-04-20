CREATE OR REPLACE FUNCTION public.handle_order_stock_decrement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status IN ('confirmed','preparing','delivered'))
     OR (TG_OP = 'UPDATE' AND NEW.status IN ('confirmed','preparing','delivered')
         AND OLD.status NOT IN ('confirmed','preparing','delivered')) THEN
    FOR v_item IN
      SELECT
        oi.product_id,
        oi.quantity,
        COALESCE(oi.unit_multiplier, 1) AS unit_multiplier,
        COALESCE(oi.purchase_unit, 'pack') AS purchase_unit
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = NEW.id
        AND oi.product_id IS NOT NULL
        AND COALESCE(p.track_stock, false) = true
    LOOP
      PERFORM public.adjust_product_stock(
        v_item.product_id,
        -(v_item.quantity * v_item.unit_multiplier),
        'sale',
        'Order ' || COALESCE(NEW.order_number, NEW.id::text) || ' (' || v_item.quantity || ' ' || v_item.purchase_unit || ')',
        NEW.id,
        'order'
      );
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled'
     AND OLD.status IN ('confirmed','preparing','delivered') THEN
    FOR v_item IN
      SELECT
        oi.product_id,
        oi.quantity,
        COALESCE(oi.unit_multiplier, 1) AS unit_multiplier,
        COALESCE(oi.purchase_unit, 'pack') AS purchase_unit
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = NEW.id
        AND oi.product_id IS NOT NULL
        AND COALESCE(p.track_stock, false) = true
    LOOP
      PERFORM public.adjust_product_stock(
        v_item.product_id,
        v_item.quantity * v_item.unit_multiplier,
        'restock',
        'Cancelled order ' || COALESCE(NEW.order_number, NEW.id::text),
        NEW.id,
        'order_cancellation'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;