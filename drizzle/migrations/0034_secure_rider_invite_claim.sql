-- Claiming an invite now goes through a server function: with the invite table no longer
-- publicly readable, a rider cannot see an unclaimed invite row, so a direct UPDATE can
-- never match. The function derives the rider from auth.uid() and never trusts input.
CREATE OR REPLACE FUNCTION public.claim_vendor_rider_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_invite uuid;
BEGIN
  IF auth.uid() IS NULL OR p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_role(auth.uid(), 'rider'::app_role) THEN
    RETURN NULL;
  END IF;

  v_profile := public.get_rider_profile_id(auth.uid());
  IF v_profile IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.vendor_rider_invites
     SET is_used = true,
         used_by = v_profile
   WHERE invite_code = btrim(p_code)
     AND COALESCE(is_used, false) = false
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id INTO v_invite;

  RETURN v_invite;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_vendor_rider_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_vendor_rider_invite(text) TO authenticated;

-- The direct-update policy cannot be satisfied (no read visibility before claiming);
-- remove it so the server function is the only claim path.
DROP POLICY IF EXISTS "Riders can claim a valid invite" ON public.vendor_rider_invites;