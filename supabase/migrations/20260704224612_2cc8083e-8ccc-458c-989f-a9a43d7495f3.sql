INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'whatsapp_from_number',
  'whatsapp:+14155238886',
  'Active WhatsApp sender number used by Twilio (E.164, with whatsapp: prefix).'
)
ON CONFLICT (key) DO NOTHING;