
ALTER TABLE public.prescription_orders
  ADD COLUMN IF NOT EXISTS symptoms TEXT,
  ADD COLUMN IF NOT EXISTS pharmacist_suggested_drug TEXT,
  ADD COLUMN IF NOT EXISTS pharmacist_note TEXT,
  ADD COLUMN IF NOT EXISTS pharmacist_dosage_instructions TEXT;

-- Reject with an optional drug suggestion + note.
-- Refunds the customer just like reject_prescription_item does.
CREATE OR REPLACE FUNCTION public.reject_prescription_with_suggestion(
  _prescription_id UUID,
  _reason TEXT,
  _suggested_drug TEXT DEFAULT NULL,
  _note TEXT DEFAULT NULL
)
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
      pharmacist_suggested_drug = NULLIF(TRIM(COALESCE(_suggested_drug, '')), ''),
      pharmacist_note = NULLIF(TRIM(COALESCE(_note, '')), ''),
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
      jsonb_build_object(
        'order_id', v_order_id,
        'prescription_id', _prescription_id,
        'product_id', v_product_id,
        'reason', _reason,
        'suggested_drug', _suggested_drug,
        'pharmacist_note', _note
      )
    )
    ON CONFLICT (reference) DO NOTHING;
  END IF;
END;
$$;

-- Approve with explicit pharmacist dosage instructions the customer will see.
CREATE OR REPLACE FUNCTION public.approve_prescription_with_instructions(
  _prescription_id UUID,
  _instructions TEXT
)
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
      pharmacist_dosage_instructions = NULLIF(TRIM(COALESCE(_instructions, '')), ''),
      updated_at = now()
  WHERE id = _prescription_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_prescription_with_suggestion(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_prescription_with_instructions(UUID, TEXT) TO authenticated;
