-- Narrowly scoped access-control hardening for five tables flagged by the security scan.
-- Additive only: no table/column drops, no data changes.

-- 1. Shared, recursion-safe participant check for order evidence tables.
CREATE OR REPLACE FUNCTION public.can_access_order_evidence(_user_id uuid, _order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND _order_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = _order_id
      AND (
        o.user_id = _user_id
        OR o.rider_id = _user_id
        OR public.owns_vendor(_user_id, o.vendor_id)
        OR public.owns_outlet(_user_id, o.outlet_id)
        OR public.get_vendor_staff_role(_user_id, o.vendor_id) IS NOT NULL
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_order_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_order_evidence(uuid, uuid) TO authenticated, service_role;

-- 2. wallet_repair_audit_2026_08: no row level security at all -> admin read only.
ALTER TABLE public.wallet_repair_audit_2026_08 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_repair_audit_2026_08 FROM anon;
REVOKE ALL ON public.wallet_repair_audit_2026_08 FROM authenticated;
GRANT SELECT ON public.wallet_repair_audit_2026_08 TO authenticated;
GRANT ALL ON public.wallet_repair_audit_2026_08 TO service_role;

DROP POLICY IF EXISTS "Admins can read wallet repair audit" ON public.wallet_repair_audit_2026_08;
CREATE POLICY "Admins can read wallet repair audit"
ON public.wallet_repair_audit_2026_08
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. vendor_rider_invites: remove the public "anyone can read every invite" rule.
DROP POLICY IF EXISTS "Anyone can view invites by code" ON public.vendor_rider_invites;
REVOKE ALL ON public.vendor_rider_invites FROM anon;

DROP POLICY IF EXISTS "Vendor team and invited rider view invites" ON public.vendor_rider_invites;
CREATE POLICY "Vendor team and invited rider view invites"
ON public.vendor_rider_invites
FOR SELECT
TO authenticated
USING (
  public.owns_vendor(auth.uid(), vendor_id)
  OR public.owns_outlet(auth.uid(), outlet_id)
  OR public.get_vendor_staff_role(auth.uid(), vendor_id) IS NOT NULL
  OR (used_by IS NOT NULL AND used_by = public.get_rider_profile_id(auth.uid()))
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

-- Riders redeeming a valid invite may mark only that invite used, as themselves.
DROP POLICY IF EXISTS "Riders can claim a valid invite" ON public.vendor_rider_invites;
CREATE POLICY "Riders can claim a valid invite"
ON public.vendor_rider_invites
FOR UPDATE
TO authenticated
USING (
  COALESCE(is_used, false) = false
  AND (expires_at IS NULL OR expires_at > now())
  AND public.has_role(auth.uid(), 'rider'::app_role)
)
WITH CHECK (
  is_used = true
  AND used_by IS NOT NULL
  AND used_by = public.get_rider_profile_id(auth.uid())
);

-- Authenticated riders resolve an invite by its code without being able to list invites.
CREATE OR REPLACE FUNCTION public.lookup_vendor_rider_invite(p_code text)
RETURNS TABLE (id uuid, vendor_id uuid, outlet_id uuid, is_used boolean, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.vendor_id, i.outlet_id, COALESCE(i.is_used, false), i.expires_at
  FROM public.vendor_rider_invites i
  WHERE auth.uid() IS NOT NULL
    AND p_code IS NOT NULL
    AND length(btrim(p_code)) > 0
    AND i.invite_code = btrim(p_code)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_vendor_rider_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_vendor_rider_invite(text) TO authenticated;

-- 4. dispute_images: participants, uploader and admins only.
DROP POLICY IF EXISTS "Authenticated users can view dispute images" ON public.dispute_images;
REVOKE ALL ON public.dispute_images FROM anon;

DROP POLICY IF EXISTS "Participants and admins view dispute images" ON public.dispute_images;
CREATE POLICY "Participants and admins view dispute images"
ON public.dispute_images
FOR SELECT
TO authenticated
USING (
  uploaded_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.can_access_order_evidence(auth.uid(), order_id)
);

-- 5. order_proof_photos: participants, uploader and admins only.
DROP POLICY IF EXISTS "Authenticated users can view proof photos" ON public.order_proof_photos;
REVOKE ALL ON public.order_proof_photos FROM anon;

DROP POLICY IF EXISTS "Participants and admins view proof photos" ON public.order_proof_photos;
CREATE POLICY "Participants and admins view proof photos"
ON public.order_proof_photos
FOR SELECT
TO authenticated
USING (
  uploaded_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.can_access_order_evidence(auth.uid(), order_id)
);

-- 6. rider_payout_settings: admin-managed configuration; edge functions use the service role.
DROP POLICY IF EXISTS "Authenticated can read rider payout settings" ON public.rider_payout_settings;
REVOKE ALL ON public.rider_payout_settings FROM anon;
GRANT ALL ON public.rider_payout_settings TO service_role;