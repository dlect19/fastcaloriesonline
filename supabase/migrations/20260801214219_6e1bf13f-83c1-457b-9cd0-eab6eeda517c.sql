INSERT INTO public.platform_settings (key, value, description)
VALUES
  ('whatsapp_login_enabled', 'false', 'Show WhatsApp number login option on the customer auth page'),
  ('whatsapp_signup_enabled', 'false', 'Show WhatsApp number sign-up option on the customer auth page')
ON CONFLICT (key) DO NOTHING;