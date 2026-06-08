
ALTER TABLE public.prescription_orders
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_prescription_orders_pending_emergency
  ON public.prescription_orders (vendor_id, is_emergency, approval_status)
  WHERE approval_status = 'pending';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS delivery_otp TEXT,
  ADD COLUMN IF NOT EXISTS delivery_otp_verified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_controlled_delivery_otp()
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
    NEW.delivery_otp := LPAD((FLOOR(RANDOM() * 1000000))::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_controlled_otp ON public.order_items;
CREATE TRIGGER trg_order_items_controlled_otp
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_controlled_delivery_otp();

ALTER TABLE public.vendor_staff
  ADD COLUMN IF NOT EXISTS is_pharmacist BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.approve_prescription_item(_prescription_id UUID, _notes TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id UUID;
  v_is_owner BOOLEAN;
  v_is_pharmacist_staff BOOLEAN;
BEGIN
  SELECT vendor_id INTO v_vendor_id FROM public.prescription_orders WHERE id = _prescription_id;
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Prescription not found';
  END IF;

  v_is_owner := public.owns_vendor(auth.uid(), v_vendor_id);
  SELECT EXISTS (
    SELECT 1 FROM public.vendor_staff
    WHERE vendor_id = v_vendor_id
      AND user_id = auth.uid()
      AND is_active = true
      AND is_pharmacist = true
  ) INTO v_is_pharmacist_staff;

  IF NOT (v_is_owner OR v_is_pharmacist_staff) THEN
    RAISE EXCEPTION 'Not authorised to review prescriptions for this vendor';
  END IF;

  UPDATE public.prescription_orders
  SET approval_status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = COALESCE(_notes, rejection_reason),
      updated_at = now()
  WHERE id = _prescription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_prescription_item(_prescription_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id UUID;
  v_order_id UUID;
  v_product_id UUID;
  v_user_id UUID;
  v_is_owner BOOLEAN;
  v_is_pharmacist_staff BOOLEAN;
  v_refund NUMERIC := 0;
BEGIN
  IF _reason IS NULL OR LENGTH(TRIM(_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT vendor_id, order_id, product_id, user_id
    INTO v_vendor_id, v_order_id, v_product_id, v_user_id
  FROM public.prescription_orders WHERE id = _prescription_id;
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Prescription not found';
  END IF;

  v_is_owner := public.owns_vendor(auth.uid(), v_vendor_id);
  SELECT EXISTS (
    SELECT 1 FROM public.vendor_staff
    WHERE vendor_id = v_vendor_id
      AND user_id = auth.uid()
      AND is_active = true
      AND is_pharmacist = true
  ) INTO v_is_pharmacist_staff;

  IF NOT (v_is_owner OR v_is_pharmacist_staff) THEN
    RAISE EXCEPTION 'Not authorised to review prescriptions for this vendor';
  END IF;

  UPDATE public.prescription_orders
  SET approval_status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = _reason,
      updated_at = now()
  WHERE id = _prescription_id;

  SELECT COALESCE(SUM(price * quantity), 0) INTO v_refund
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_product_id;

  IF v_refund > 0 THEN
    INSERT INTO public.wallet_transactions (
      user_id, amount, type, status, reference, description, metadata
    ) VALUES (
      v_user_id,
      v_refund,
      'refund',
      'completed',
      'rx_reject_' || _prescription_id::text,
      'Refund for rejected prescription item',
      jsonb_build_object('order_id', v_order_id, 'prescription_id', _prescription_id, 'product_id', v_product_id, 'reason', _reason)
    )
    ON CONFLICT (reference) DO NOTHING;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_prescription_item(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_prescription_item(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Customers manage own prescription uploads" ON storage.objects;
CREATE POLICY "Customers manage own prescription uploads"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Pharmacy reviewers read prescription uploads" ON storage.objects;
CREATE POLICY "Pharmacy reviewers read prescription uploads"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND EXISTS (
      SELECT 1
      FROM public.prescription_orders po
      WHERE po.prescription_image_url = storage.objects.name
        AND (
          public.owns_vendor(auth.uid(), po.vendor_id)
          OR EXISTS (
            SELECT 1 FROM public.vendor_staff vs
            WHERE vs.vendor_id = po.vendor_id
              AND vs.user_id = auth.uid()
              AND vs.is_active = true
              AND vs.is_pharmacist = true
          )
        )
    )
  );
