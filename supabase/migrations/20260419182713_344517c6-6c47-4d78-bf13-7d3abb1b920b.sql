-- Track if a customer has already used the pharmacy welcome bonus
ALTER TABLE public.user_order_stats
ADD COLUMN IF NOT EXISTS first_pharmacy_order_promo_used boolean NOT NULL DEFAULT false;

-- Seed default platform settings for pharmacy welcome bonus
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('pharmacy_welcome_enabled', 'true', 'Enable welcome bonus on first pharmacy order'),
  ('pharmacy_welcome_type', 'percent', 'Type of pharmacy welcome bonus: percent or fixed'),
  ('pharmacy_welcome_percent', '5', 'Percent off first pharmacy order (when type=percent)'),
  ('pharmacy_welcome_fixed', '200', 'Fixed naira amount off first pharmacy order (when type=fixed)')
ON CONFLICT (key) DO NOTHING;