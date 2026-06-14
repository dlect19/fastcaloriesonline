CREATE OR REPLACE FUNCTION public.update_user_order_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND (OLD.status IS NULL OR OLD.status != 'delivered')
     AND NEW.user_id IS NOT NULL THEN
    INSERT INTO public.user_order_stats (user_id, completed_orders, total_spent)
    VALUES (NEW.user_id, 1, COALESCE(NEW.subtotal, 0))
    ON CONFLICT (user_id) DO UPDATE SET
      completed_orders = COALESCE(public.user_order_stats.completed_orders, 0) + 1,
      total_spent = COALESCE(public.user_order_stats.total_spent, 0) + COALESCE(NEW.subtotal, 0),
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;