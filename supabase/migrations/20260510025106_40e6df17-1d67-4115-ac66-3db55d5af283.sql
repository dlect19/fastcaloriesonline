UPDATE public.platform_settings SET value = 'true', updated_at = now() WHERE key = 'whatsapp_ordering_enabled';
INSERT INTO public.platform_settings (key, value)
SELECT 'whatsapp_ordering_enabled', 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'whatsapp_ordering_enabled');