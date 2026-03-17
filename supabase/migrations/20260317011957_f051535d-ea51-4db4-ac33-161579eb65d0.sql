
-- Fix overly permissive INSERT on ad_impressions: require viewer_user_id matches caller
DROP POLICY "Insert impressions via service" ON public.ad_impressions;
CREATE POLICY "Users can log own impressions" ON public.ad_impressions FOR INSERT TO authenticated
  WITH CHECK (viewer_user_id = auth.uid());
