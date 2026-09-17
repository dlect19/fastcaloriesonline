-- Voice-note cost gating for WhatsApp: server-authoritative limits, one
-- reservation per provider message (idempotent), redacted usage audit.

CREATE TABLE IF NOT EXISTS public.whatsapp_voice_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_sid text NOT NULL,
  phone text NOT NULL,
  user_id uuid,
  status text NOT NULL DEFAULT 'reserved',
  bytes integer,
  duration_seconds numeric,
  model text,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_voice_usage_message_sid_key
  ON public.whatsapp_voice_usage (message_sid);
CREATE INDEX IF NOT EXISTS whatsapp_voice_usage_phone_created_idx
  ON public.whatsapp_voice_usage (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_voice_usage_created_idx
  ON public.whatsapp_voice_usage (created_at DESC);

GRANT SELECT ON public.whatsapp_voice_usage TO authenticated;
GRANT ALL ON public.whatsapp_voice_usage TO service_role;

ALTER TABLE public.whatsapp_voice_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read whatsapp voice usage" ON public.whatsapp_voice_usage;
CREATE POLICY "Admins read whatsapp voice usage"
ON public.whatsapp_voice_usage
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Safe defaults. Voice stays ON (existing behaviour) but bounded.
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('whatsapp_voice_enabled', 'true', 'WhatsApp voice-note transcription master switch'),
  ('whatsapp_voice_max_bytes', '5242880', 'Maximum inbound voice-note size in bytes'),
  ('whatsapp_voice_max_seconds', '120', 'Maximum inbound voice-note duration in seconds'),
  ('whatsapp_voice_per_phone_per_minute', '3', 'Voice notes accepted per phone per minute'),
  ('whatsapp_voice_per_phone_per_hour', '20', 'Voice notes accepted per phone per hour'),
  ('whatsapp_voice_per_phone_per_day', '60', 'Voice notes accepted per phone per day'),
  ('whatsapp_voice_global_per_day', '2000', 'Voice notes transcribed platform-wide per day'),
  ('whatsapp_voice_global_concurrency', '10', 'Concurrent voice transcriptions allowed'),
  ('whatsapp_voice_retention_days', '30', 'Days of voice usage audit rows kept')
ON CONFLICT (key) DO NOTHING;

-- Reserve before any expensive work. Same provider message id returns the
-- existing reservation instead of transcribing (or charging) twice.
CREATE OR REPLACE FUNCTION public.whatsapp_voice_reserve(
  p_message_sid text,
  p_phone text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_minute int; v_hour int; v_day int; v_global int; v_concurrency int;
  v_existing public.whatsapp_voice_usage;
  v_count int;
BEGIN
  IF p_message_sid IS NULL OR btrim(p_message_sid) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MESSAGE_ID_REQUIRED');
  END IF;

  SELECT * INTO v_existing FROM public.whatsapp_voice_usage WHERE message_sid = p_message_sid;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'REPLAY', 'replay', true,
      'status', v_existing.status, 'outcome', v_existing.outcome
    );
  END IF;

  SELECT COALESCE((SELECT value FROM public.platform_settings WHERE key = 'whatsapp_voice_enabled'), 'true') = 'true'
    INTO v_enabled;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'VOICE_DISABLED');
  END IF;

  SELECT COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_per_phone_per_minute'), 3),
         COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_per_phone_per_hour'), 20),
         COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_per_phone_per_day'), 60),
         COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_global_per_day'), 2000),
         COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_global_concurrency'), 10)
    INTO v_minute, v_hour, v_day, v_global, v_concurrency;

  SELECT count(*) INTO v_count FROM public.whatsapp_voice_usage
   WHERE phone = p_phone AND created_at > now() - interval '1 minute';
  IF v_count >= v_minute THEN RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED_MINUTE'); END IF;

  SELECT count(*) INTO v_count FROM public.whatsapp_voice_usage
   WHERE phone = p_phone AND created_at > now() - interval '1 hour';
  IF v_count >= v_hour THEN RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED_HOUR'); END IF;

  SELECT count(*) INTO v_count FROM public.whatsapp_voice_usage
   WHERE phone = p_phone AND created_at > now() - interval '1 day';
  IF v_count >= v_day THEN RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED_DAY'); END IF;

  SELECT count(*) INTO v_count FROM public.whatsapp_voice_usage
   WHERE created_at > now() - interval '1 day';
  IF v_count >= v_global THEN RETURN jsonb_build_object('ok', false, 'reason', 'DAILY_CEILING'); END IF;

  SELECT count(*) INTO v_count FROM public.whatsapp_voice_usage
   WHERE status = 'reserved' AND created_at > now() - interval '5 minutes';
  IF v_count >= v_concurrency THEN RETURN jsonb_build_object('ok', false, 'reason', 'BUSY'); END IF;

  INSERT INTO public.whatsapp_voice_usage (message_sid, phone, user_id, status)
  VALUES (p_message_sid, p_phone, p_user_id, 'reserved')
  ON CONFLICT (message_sid) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_voice_usage WHERE message_sid = p_message_sid AND status = 'reserved') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REPLAY', 'replay', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'max_bytes', COALESCE((SELECT value::bigint FROM public.platform_settings WHERE key = 'whatsapp_voice_max_bytes'), 5242880),
    'max_seconds', COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_max_seconds'), 120)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_voice_reserve(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_voice_reserve(text, text, uuid) TO service_role;

-- Finalize (or release) the reservation, and prune old audit rows.
CREATE OR REPLACE FUNCTION public.whatsapp_voice_finalize(
  p_message_sid text,
  p_status text,
  p_bytes integer DEFAULT NULL,
  p_outcome text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_duration_seconds numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention int;
BEGIN
  UPDATE public.whatsapp_voice_usage
     SET status = COALESCE(NULLIF(btrim(p_status), ''), 'done'),
         bytes = COALESCE(p_bytes, bytes),
         outcome = COALESCE(left(p_outcome, 120), outcome),
         model = COALESCE(p_model, model),
         duration_seconds = COALESCE(p_duration_seconds, duration_seconds),
         finalized_at = now()
   WHERE message_sid = p_message_sid;

  SELECT COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'whatsapp_voice_retention_days'), 30)
    INTO v_retention;
  DELETE FROM public.whatsapp_voice_usage
   WHERE created_at < now() - (v_retention || ' days')::interval;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_voice_finalize(text, text, integer, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_voice_finalize(text, text, integer, text, text, numeric) TO service_role;