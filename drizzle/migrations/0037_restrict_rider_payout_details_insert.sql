-- Only server code (service role, used by accept-dispatch) may create payout detail rows.
DROP POLICY IF EXISTS "Service role can insert payout details" ON public.rider_payout_details;
CREATE POLICY "Service role can insert payout details" ON public.rider_payout_details
  FOR INSERT TO service_role WITH CHECK (true);
