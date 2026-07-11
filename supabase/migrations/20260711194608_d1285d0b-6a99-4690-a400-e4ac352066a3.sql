
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS admin_unattended_alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_unattended_lookup
  ON public.orders (status, payment_status, admin_unattended_alerted_at)
  WHERE status = 'pending' AND admin_unattended_alerted_at IS NULL;

INSERT INTO public.platform_settings (key, value, description)
VALUES
  ('admin_unattended_alert_enabled', 'false', 'Send WhatsApp to admin when a vendor does not attend to a paid order within the threshold'),
  ('admin_unattended_alert_phone', '', 'Admin WhatsApp phone number (E.164, e.g. +2348012345678) to receive unattended order alerts'),
  ('admin_unattended_alert_minutes', '5', 'Minutes to wait after a paid order comes in before alerting admin if vendor has not accepted')
ON CONFLICT (key) DO NOTHING;
