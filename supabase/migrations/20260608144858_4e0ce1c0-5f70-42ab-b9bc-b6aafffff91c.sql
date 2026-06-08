
-- 1) pharmacy_review_status on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pharmacy_review_status TEXT NOT NULL DEFAULT 'not_required';

-- Recompute helper
CREATE OR REPLACE FUNCTION public.recompute_order_pharmacy_status(_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total INT;
  pending_cnt INT;
  rejected_cnt INT;
  approved_cnt INT;
  new_status TEXT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE requires_approval = true),
         COUNT(*) FILTER (WHERE requires_approval = true AND approval_status = 'pending'),
         COUNT(*) FILTER (WHERE requires_approval = true AND approval_status = 'rejected'),
         COUNT(*) FILTER (WHERE requires_approval = true AND approval_status = 'approved')
    INTO total, pending_cnt, rejected_cnt, approved_cnt
  FROM public.prescription_orders
  WHERE order_id = _order_id;

  IF total = 0 THEN
    new_status := 'not_required';
  ELSIF pending_cnt > 0 THEN
    new_status := 'pending';
  ELSIF approved_cnt > 0 AND rejected_cnt > 0 THEN
    new_status := 'partially_rejected';
  ELSIF approved_cnt > 0 THEN
    new_status := 'approved';
  ELSE
    new_status := 'rejected';
  END IF;

  UPDATE public.orders SET pharmacy_review_status = new_status WHERE id = _order_id;
END;
$$;

-- Trigger on prescription_orders
CREATE OR REPLACE FUNCTION public.trg_sync_order_pharmacy_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_order_pharmacy_status(COALESCE(NEW.order_id, OLD.order_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS prescription_orders_sync_status ON public.prescription_orders;
CREATE TRIGGER prescription_orders_sync_status
AFTER INSERT OR UPDATE OR DELETE ON public.prescription_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_order_pharmacy_status();

-- Backfill existing orders
UPDATE public.orders o
SET pharmacy_review_status = CASE
  WHEN NOT EXISTS (SELECT 1 FROM public.prescription_orders p WHERE p.order_id = o.id AND p.requires_approval = true) THEN 'not_required'
  WHEN EXISTS (SELECT 1 FROM public.prescription_orders p WHERE p.order_id = o.id AND p.requires_approval = true AND p.approval_status = 'pending') THEN 'pending'
  WHEN EXISTS (SELECT 1 FROM public.prescription_orders p WHERE p.order_id = o.id AND p.requires_approval = true AND p.approval_status = 'approved')
   AND EXISTS (SELECT 1 FROM public.prescription_orders p WHERE p.order_id = o.id AND p.requires_approval = true AND p.approval_status = 'rejected')
    THEN 'partially_rejected'
  WHEN EXISTS (SELECT 1 FROM public.prescription_orders p WHERE p.order_id = o.id AND p.requires_approval = true AND p.approval_status = 'approved') THEN 'approved'
  ELSE 'rejected'
END;

-- 2) Controlled-drug OTP auto-generation on order_items
CREATE OR REPLACE FUNCTION public.trg_generate_controlled_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cls TEXT;
BEGIN
  IF NEW.delivery_otp IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT medicine_classification INTO cls FROM public.products WHERE id = NEW.product_id;
  IF cls = 'controlled' THEN
    NEW.delivery_otp := LPAD(floor(random() * 1000000)::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_controlled_otp ON public.order_items;
CREATE TRIGGER order_items_controlled_otp
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.trg_generate_controlled_otp();
