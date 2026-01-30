-- Fix: Allow users to insert their own rider role (for VendorRiderJoin flow)
CREATE POLICY "Users can insert own rider role" ON public.user_roles
FOR INSERT WITH CHECK (auth.uid() = user_id AND role = 'rider');

-- Add payout approval mode setting
INSERT INTO public.platform_settings (key, value, description)
VALUES ('payout_approval_mode', 'manual', 'Payout approval mode: auto or manual')
ON CONFLICT (key) DO NOTHING;

-- Add default navigation app setting
INSERT INTO public.platform_settings (key, value, description)
VALUES ('default_navigation_app', 'google_maps', 'Default navigation app: google_maps, waze, apple_maps')
ON CONFLICT (key) DO NOTHING;