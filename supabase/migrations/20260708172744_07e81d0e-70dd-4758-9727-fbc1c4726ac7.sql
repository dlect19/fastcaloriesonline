ALTER TABLE public.twilio_api_logs
  ADD COLUMN IF NOT EXISTS order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS twilio_api_logs_order_id_idx ON public.twilio_api_logs(order_id);

INSERT INTO public.platform_settings (key, value)
VALUES ('service_fee_include_twilio', to_jsonb('false'::text))
ON CONFLICT (key) DO NOTHING;