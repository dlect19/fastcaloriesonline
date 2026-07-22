
CREATE OR REPLACE FUNCTION public.mark_first_pharmacy_order_used()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT category INTO v_category FROM public.vendors WHERE id = NEW.vendor_id;
  IF v_category IS DISTINCT FROM 'pharmacy' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_order_stats (user_id, first_pharmacy_order_promo_used, updated_at)
  VALUES (NEW.user_id, true, now())
  ON CONFLICT (user_id) DO UPDATE
    SET first_pharmacy_order_promo_used = true,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_first_pharmacy_order_used ON public.orders;
CREATE TRIGGER trg_mark_first_pharmacy_order_used
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_first_pharmacy_order_used();

-- Backfill: any user who already placed a pharmacy order should have the flag set
INSERT INTO public.user_order_stats (user_id, first_pharmacy_order_promo_used, updated_at)
SELECT DISTINCT o.user_id, true, now()
FROM public.orders o
JOIN public.vendors v ON v.id = o.vendor_id
WHERE v.category = 'pharmacy' AND o.user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET first_pharmacy_order_promo_used = true,
      updated_at = now();
