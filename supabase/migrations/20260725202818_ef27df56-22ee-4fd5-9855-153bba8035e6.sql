CREATE OR REPLACE FUNCTION public.get_voucher_wallet_reconciliation(p_vendor_id uuid, p_environment text DEFAULT NULL::text)
RETURNS TABLE(
  order_id uuid,
  purchased_at timestamp with time zone,
  category_name text,
  buyer_email text,
  buyer_phone text,
  gross_amount numeric,
  commission_amount numeric,
  net_expected numeric,
  ledger_amount numeric,
  ledger_status text,
  wallet_pool text,
  release_at timestamp with time zone,
  released boolean,
  wallet_id uuid,
  transaction_id uuid,
  paystack_reference text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
  v_owner uuid;
  v_allowed boolean;
BEGIN
  v_env := COALESCE(p_environment, get_platform_environment());

  SELECT user_id INTO v_owner FROM public.vendors WHERE id = p_vendor_id;
  v_allowed := v_owner = auth.uid()
    OR public.owns_vendor(auth.uid(), p_vendor_id)
    OR EXISTS (
      SELECT 1 FROM public.vendor_staff vs
      WHERE vs.vendor_id = p_vendor_id AND vs.user_id = auth.uid() AND vs.is_active = true
    )
    OR public.has_role(auth.uid(), 'admin');

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  SELECT
    vo.id,
    vo.purchased_at,
    vc.name::text,
    vo.guest_email::text,
    vo.guest_phone::text,
    vo.amount,
    COALESCE(vo.commission_amount, 0),
    vo.amount - COALESCE(vo.commission_amount, 0),
    COALESCE(wt.amount, 0),
    COALESCE(wt.status, 'missing')::text,
    CASE
      WHEN wt.id IS NULL THEN 'missing'
      WHEN COALESCE(wt.release_at, wt.created_at) > NOW() THEN 'pending'
      ELSE 'available'
    END::text,
    wt.release_at,
    COALESCE(ppr.released, COALESCE(wt.release_at, wt.created_at) <= NOW()),
    wt.wallet_id,
    wt.id,
    vo.paystack_reference::text
  FROM public.voucher_orders vo
  LEFT JOIN public.voucher_categories vc ON vc.id = vo.category_id
  LEFT JOIN public.wallet_transactions wt
    ON wt.category = 'voucher_sale'
   AND wt.environment = v_env
   AND wt.metadata->>'voucher_order_id' = vo.id::text
  LEFT JOIN public.payout_pending_releases ppr ON ppr.transaction_id = wt.id
  WHERE vo.vendor_id = p_vendor_id
    AND vo.status = 'paid'
  ORDER BY vo.purchased_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_voucher_wallet_reconciliation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_wallet_reconciliation(uuid, text) TO service_role;