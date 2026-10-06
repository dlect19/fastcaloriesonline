REVOKE ALL ON public.rider_live_locations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.rider_live_locations FROM authenticated;
REVOKE ALL ON public.rider_tracking_daily_metrics FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.rider_tracking_daily_metrics FROM authenticated;
REVOKE ALL ON FUNCTION public.rider_tracking_setting(text, text) FROM PUBLIC, anon;