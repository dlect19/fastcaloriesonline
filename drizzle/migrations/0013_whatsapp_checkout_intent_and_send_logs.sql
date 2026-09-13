-- Phase 7: idempotency bound to a per-attempt checkout intent (not cart contents)
ALTER TABLE public.whatsapp_carts
  ADD COLUMN IF NOT EXISTS checkout_intent_key TEXT;

-- Phase 9: correlate every outbound WhatsApp send with its session and provider status
ALTER TABLE public.twilio_api_logs
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS attempt INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_status_code INTEGER;

CREATE INDEX IF NOT EXISTS idx_twilio_api_logs_session
  ON public.twilio_api_logs (session_id, created_at DESC);