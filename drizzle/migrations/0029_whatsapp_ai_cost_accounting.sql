-- WhatsApp AI cost accounting: immutable usage ledger, versioned provider rate
-- cards and server-authoritative frozen cost quotes. Additive only. Customer
-- billing defaults to SHADOW mode (customer pays 0) until an admin enables it.

-- 1) Versioned provider rate cards -------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL,
  provider text NOT NULL DEFAULT 'lovable_gateway',
  effective_from timestamptz NOT NULL DEFAULT now(),
  input_usd_per_mtok numeric(18,6),
  output_usd_per_mtok numeric(18,6),
  thinking_usd_per_mtok numeric(18,6),
  cached_input_usd_per_mtok numeric(18,6),
  audio_usd_per_mtok numeric(18,6),
  audio_usd_per_minute numeric(18,6),
  rate_source text NOT NULL DEFAULT 'admin_entered',
  is_confirmed boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, provider, effective_from)
);

GRANT SELECT ON public.whatsapp_ai_rate_cards TO authenticated;
GRANT ALL ON public.whatsapp_ai_rate_cards TO service_role;
ALTER TABLE public.whatsapp_ai_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ai rate cards" ON public.whatsapp_ai_rate_cards
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Immutable, idempotent usage ledger ---------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL,
  event_kind text NOT NULL,
  direction text,
  message_sid text,
  ai_run_id text,
  phone_hash text,
  customer_user_id uuid,
  session_id uuid,
  cart_id uuid,
  order_id uuid,
  checkout_attempt_key text,
  model_id text,
  provider text,
  window_state text NOT NULL DEFAULT 'unknown',
  country_code text,
  message_category text,
  quantity numeric(18,6) NOT NULL DEFAULT 1,
  unit_label text,
  input_tokens integer,
  output_tokens integer,
  thinking_tokens integer,
  cached_input_tokens integer,
  transcription_seconds numeric(12,3),
  rate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd_micros bigint NOT NULL DEFAULT 0,
  fx_rate_ngn numeric(18,6),
  fx_source text,
  fx_captured_at timestamptz,
  cost_ngn_kobo bigint NOT NULL DEFAULT 0,
  cost_status text NOT NULL DEFAULT 'estimated',
  billed_ngn_kobo bigint NOT NULL DEFAULT 0,
  subsidy_ngn_kobo bigint NOT NULL DEFAULT 0,
  markup_ngn_kobo bigint NOT NULL DEFAULT 0,
  billing_status text NOT NULL DEFAULT 'unbilled',
  quote_id uuid,
  config_version text,
  environment text NOT NULL DEFAULT 'development',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT whatsapp_usage_events_provider_event_id_key UNIQUE (provider_event_id),
  CONSTRAINT whatsapp_usage_cost_status_chk CHECK (cost_status IN ('estimated','final','unknown_rate','reconciled','reversed')),
  CONSTRAINT whatsapp_usage_billing_status_chk CHECK (billing_status IN ('unbilled','quoted','allocated','absorbed','shadow','reversed'))
);

CREATE INDEX IF NOT EXISTS whatsapp_usage_events_session_idx
  ON public.whatsapp_usage_events (session_id, billing_status, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_usage_events_created_idx
  ON public.whatsapp_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_usage_events_sid_idx
  ON public.whatsapp_usage_events (message_sid);
CREATE INDEX IF NOT EXISTS whatsapp_usage_events_order_idx
  ON public.whatsapp_usage_events (order_id);

GRANT SELECT ON public.whatsapp_usage_events TO authenticated;
GRANT ALL ON public.whatsapp_usage_events TO service_role;
ALTER TABLE public.whatsapp_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read whatsapp usage events" ON public.whatsapp_usage_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Immutability: no deletes, and the recorded facts can never be rewritten.
CREATE OR REPLACE FUNCTION public.whatsapp_usage_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'whatsapp_usage_events is append-only';
  END IF;
  IF NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.event_kind IS DISTINCT FROM OLD.event_kind
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens
     OR NEW.output_tokens IS DISTINCT FROM OLD.output_tokens
     OR NEW.thinking_tokens IS DISTINCT FROM OLD.thinking_tokens
     OR NEW.cached_input_tokens IS DISTINCT FROM OLD.cached_input_tokens
     OR NEW.transcription_seconds IS DISTINCT FROM OLD.transcription_seconds
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'recorded usage facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_usage_events_immutable_trg ON public.whatsapp_usage_events;
CREATE TRIGGER whatsapp_usage_events_immutable_trg
  BEFORE UPDATE OR DELETE ON public.whatsapp_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_usage_events_immutable();

-- 3) Frozen, server-authoritative cost quotes ---------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_cost_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text,
  session_id uuid,
  customer_user_id uuid,
  vendor_id uuid,
  outlet_id uuid,
  fulfilment_type text,
  payment_method text,
  checkout_fingerprint text NOT NULL,
  checkout_attempt_key text NOT NULL,
  usage_event_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  raw_cost_ngn_kobo bigint NOT NULL DEFAULT 0,
  reserve_ngn_kobo bigint NOT NULL DEFAULT 0,
  markup_ngn_kobo bigint NOT NULL DEFAULT 0,
  allowance_ngn_kobo bigint NOT NULL DEFAULT 0,
  subsidy_ngn_kobo bigint NOT NULL DEFAULT 0,
  customer_fee_ngn_kobo bigint NOT NULL DEFAULT 0,
  billing_mode text NOT NULL DEFAULT 'shadow',
  fx_rate_ngn numeric(18,6),
  rate_version text,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_order_id uuid,
  environment text NOT NULL DEFAULT 'development',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_cost_quotes_status_chk CHECK (status IN ('active','consumed','expired','superseded')),
  CONSTRAINT whatsapp_cost_quotes_mode_chk CHECK (billing_mode IN ('shadow','live'))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_cost_quotes_active_attempt_idx
  ON public.whatsapp_cost_quotes (checkout_attempt_key, checkout_fingerprint)
  WHERE status = 'active';

GRANT SELECT ON public.whatsapp_cost_quotes TO authenticated;
GRANT ALL ON public.whatsapp_cost_quotes TO service_role;
ALTER TABLE public.whatsapp_cost_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read whatsapp cost quotes" ON public.whatsapp_cost_quotes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Idempotent usage recording ------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_record_usage(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_new boolean := false;
  v_pid text := p_event->>'provider_event_id';
BEGIN
  IF v_pid IS NULL OR length(v_pid) = 0 THEN
    RAISE EXCEPTION 'provider_event_id required';
  END IF;

  SELECT id INTO v_id FROM public.whatsapp_usage_events WHERE provider_event_id = v_pid;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true);
  END IF;

  INSERT INTO public.whatsapp_usage_events (
    provider_event_id, event_kind, direction, message_sid, ai_run_id, phone_hash,
    customer_user_id, session_id, cart_id, order_id, checkout_attempt_key,
    model_id, provider, window_state, country_code, message_category,
    quantity, unit_label, input_tokens, output_tokens, thinking_tokens,
    cached_input_tokens, transcription_seconds, rate_snapshot, cost_usd_micros,
    fx_rate_ngn, fx_source, fx_captured_at, cost_ngn_kobo, cost_status,
    billing_status, config_version, environment, notes
  ) VALUES (
    v_pid,
    COALESCE(p_event->>'event_kind', 'unknown'),
    p_event->>'direction',
    p_event->>'message_sid',
    p_event->>'ai_run_id',
    p_event->>'phone_hash',
    NULLIF(p_event->>'customer_user_id','')::uuid,
    NULLIF(p_event->>'session_id','')::uuid,
    NULLIF(p_event->>'cart_id','')::uuid,
    NULLIF(p_event->>'order_id','')::uuid,
    p_event->>'checkout_attempt_key',
    p_event->>'model_id',
    p_event->>'provider',
    COALESCE(p_event->>'window_state','unknown'),
    p_event->>'country_code',
    p_event->>'message_category',
    COALESCE((p_event->>'quantity')::numeric, 1),
    p_event->>'unit_label',
    NULLIF(p_event->>'input_tokens','')::int,
    NULLIF(p_event->>'output_tokens','')::int,
    NULLIF(p_event->>'thinking_tokens','')::int,
    NULLIF(p_event->>'cached_input_tokens','')::int,
    NULLIF(p_event->>'transcription_seconds','')::numeric,
    COALESCE(p_event->'rate_snapshot', '{}'::jsonb),
    COALESCE((p_event->>'cost_usd_micros')::bigint, 0),
    NULLIF(p_event->>'fx_rate_ngn','')::numeric,
    p_event->>'fx_source',
    COALESCE(NULLIF(p_event->>'fx_captured_at','')::timestamptz, now()),
    COALESCE((p_event->>'cost_ngn_kobo')::bigint, 0),
    COALESCE(p_event->>'cost_status','estimated'),
    COALESCE(p_event->>'billing_status','unbilled'),
    p_event->>'config_version',
    COALESCE(p_event->>'environment','development'),
    p_event->>'notes'
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.whatsapp_usage_events WHERE provider_event_id = v_pid;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_record_usage(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_usage(jsonb) TO service_role;

-- 5) Provider reconciliation: estimated -> final / reversed -------------------
CREATE OR REPLACE FUNCTION public.whatsapp_finalize_usage(
  p_provider_event_id text,
  p_cost_usd_micros bigint,
  p_cost_ngn_kobo bigint,
  p_cost_status text DEFAULT 'final',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.whatsapp_usage_events;
BEGIN
  IF p_cost_status NOT IN ('final','reconciled','reversed','unknown_rate') THEN
    RAISE EXCEPTION 'invalid cost_status %', p_cost_status;
  END IF;

  SELECT * INTO v_row FROM public.whatsapp_usage_events
   WHERE provider_event_id = p_provider_event_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Already reconciled to the same figures: no-op (retry safe).
  IF v_row.cost_status = p_cost_status
     AND v_row.cost_usd_micros = COALESCE(p_cost_usd_micros, v_row.cost_usd_micros)
     AND v_row.cost_ngn_kobo = COALESCE(p_cost_ngn_kobo, v_row.cost_ngn_kobo) THEN
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'unchanged', true);
  END IF;

  UPDATE public.whatsapp_usage_events
     SET cost_usd_micros = COALESCE(p_cost_usd_micros, cost_usd_micros),
         cost_ngn_kobo = COALESCE(p_cost_ngn_kobo, cost_ngn_kobo),
         cost_status = p_cost_status,
         notes = COALESCE(p_notes, notes),
         finalized_at = now()
   WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'unchanged', false);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_finalize_usage(text, bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_finalize_usage(text, bigint, bigint, text, text) TO service_role;

-- 6) Freeze a cost quote (arithmetic is done server-side by the edge function,
--    this function owns atomicity, reuse and usage binding) -------------------
CREATE OR REPLACE FUNCTION public.whatsapp_freeze_cost_quote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.whatsapp_cost_quotes;
  v_id uuid;
  v_ids uuid[] := COALESCE(ARRAY(SELECT (jsonb_array_elements_text(p_payload->'usage_event_ids'))::uuid), '{}'::uuid[]);
  v_attempt text := p_payload->>'checkout_attempt_key';
  v_fp text := p_payload->>'checkout_fingerprint';
  v_bad int;
BEGIN
  IF v_attempt IS NULL OR v_fp IS NULL THEN
    RAISE EXCEPTION 'checkout_attempt_key and checkout_fingerprint required';
  END IF;

  -- Expire stale quotes for this attempt, and supersede quotes whose
  -- fingerprint no longer matches the current cart/outlet/fulfilment/payment.
  UPDATE public.whatsapp_cost_quotes
     SET status = 'expired'
   WHERE checkout_attempt_key = v_attempt AND status = 'active' AND expires_at <= now();
  UPDATE public.whatsapp_cost_quotes
     SET status = 'superseded'
   WHERE checkout_attempt_key = v_attempt AND status = 'active'
     AND checkout_fingerprint IS DISTINCT FROM v_fp;

  SELECT * INTO v_existing FROM public.whatsapp_cost_quotes
   WHERE checkout_attempt_key = v_attempt
     AND checkout_fingerprint = v_fp
     AND status = 'active'
     AND expires_at > now()
   FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'reused', true, 'quote', to_jsonb(v_existing));
  END IF;

  -- Usage rows must still be unallocated.
  SELECT count(*) INTO v_bad FROM public.whatsapp_usage_events
   WHERE id = ANY(v_ids) AND billing_status NOT IN ('unbilled','quoted');
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'usage_already_allocated');
  END IF;

  INSERT INTO public.whatsapp_cost_quotes (
    phone_hash, session_id, customer_user_id, vendor_id, outlet_id,
    fulfilment_type, payment_method, checkout_fingerprint, checkout_attempt_key,
    usage_event_ids, raw_cost_ngn_kobo, reserve_ngn_kobo, markup_ngn_kobo,
    allowance_ngn_kobo, subsidy_ngn_kobo, customer_fee_ngn_kobo, billing_mode,
    fx_rate_ngn, rate_version, config_snapshot, breakdown, expires_at, environment
  ) VALUES (
    p_payload->>'phone_hash',
    NULLIF(p_payload->>'session_id','')::uuid,
    NULLIF(p_payload->>'customer_user_id','')::uuid,
    NULLIF(p_payload->>'vendor_id','')::uuid,
    NULLIF(p_payload->>'outlet_id','')::uuid,
    p_payload->>'fulfilment_type',
    p_payload->>'payment_method',
    v_fp,
    v_attempt,
    v_ids,
    COALESCE((p_payload->>'raw_cost_ngn_kobo')::bigint, 0),
    COALESCE((p_payload->>'reserve_ngn_kobo')::bigint, 0),
    COALESCE((p_payload->>'markup_ngn_kobo')::bigint, 0),
    COALESCE((p_payload->>'allowance_ngn_kobo')::bigint, 0),
    COALESCE((p_payload->>'subsidy_ngn_kobo')::bigint, 0),
    COALESCE((p_payload->>'customer_fee_ngn_kobo')::bigint, 0),
    COALESCE(p_payload->>'billing_mode','shadow'),
    NULLIF(p_payload->>'fx_rate_ngn','')::numeric,
    p_payload->>'rate_version',
    COALESCE(p_payload->'config_snapshot','{}'::jsonb),
    COALESCE(p_payload->'breakdown','{}'::jsonb),
    COALESCE(NULLIF(p_payload->>'expires_at','')::timestamptz, now() + interval '15 minutes'),
    COALESCE(p_payload->>'environment','development')
  )
  RETURNING id INTO v_id;

  UPDATE public.whatsapp_usage_events
     SET billing_status = 'quoted', quote_id = v_id
   WHERE id = ANY(v_ids) AND billing_status = 'unbilled';

  RETURN jsonb_build_object(
    'ok', true, 'reused', false,
    'quote', (SELECT to_jsonb(q) FROM public.whatsapp_cost_quotes q WHERE q.id = v_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_freeze_cost_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_freeze_cost_quote(jsonb) TO service_role;

-- 7) Consume a quote exactly once, binding it to the created order -----------
CREATE OR REPLACE FUNCTION public.whatsapp_consume_cost_quote(
  p_quote_id uuid,
  p_order_id uuid,
  p_expected_fee_ngn_kobo bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q public.whatsapp_cost_quotes;
BEGIN
  SELECT * INTO v_q FROM public.whatsapp_cost_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_q.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_not_found');
  END IF;

  IF v_q.status = 'consumed' THEN
    IF v_q.consumed_order_id = p_order_id THEN
      RETURN jsonb_build_object('ok', true, 'replay', true,
        'customer_fee_ngn_kobo', v_q.customer_fee_ngn_kobo);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_already_consumed');
  END IF;

  IF v_q.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_' || v_q.status);
  END IF;

  IF v_q.expires_at <= now() THEN
    UPDATE public.whatsapp_cost_quotes SET status = 'expired' WHERE id = v_q.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_expired');
  END IF;

  IF p_expected_fee_ngn_kobo IS NOT NULL
     AND p_expected_fee_ngn_kobo <> v_q.customer_fee_ngn_kobo THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_fee_mismatch',
      'quote_fee_ngn_kobo', v_q.customer_fee_ngn_kobo);
  END IF;

  UPDATE public.whatsapp_cost_quotes
     SET status = 'consumed', consumed_at = now(), consumed_order_id = p_order_id
   WHERE id = v_q.id;

  -- Allocate the quoted usage to this order. In shadow mode the customer pays
  -- nothing, so the whole cost is recorded as platform subsidy.
  UPDATE public.whatsapp_usage_events e
     SET billing_status = CASE WHEN v_q.billing_mode = 'live' THEN 'allocated' ELSE 'shadow' END,
         order_id = COALESCE(e.order_id, p_order_id),
         billed_ngn_kobo = CASE WHEN v_q.billing_mode = 'live' THEN e.cost_ngn_kobo ELSE 0 END,
         subsidy_ngn_kobo = CASE WHEN v_q.billing_mode = 'live' THEN 0 ELSE e.cost_ngn_kobo END,
         quote_id = v_q.id
   WHERE e.id = ANY(v_q.usage_event_ids);

  RETURN jsonb_build_object('ok', true, 'replay', false,
    'customer_fee_ngn_kobo', v_q.customer_fee_ngn_kobo,
    'billing_mode', v_q.billing_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_consume_cost_quote(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_consume_cost_quote(uuid, uuid, bigint) TO service_role;

-- 8) Shadow-mode defaults + reference rate cards ------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES
  ('whatsapp_cost_tracking_enabled', 'true'),
  ('whatsapp_cost_billing_enabled', 'false'),
  ('whatsapp_cost_emergency_disable', 'false'),
  ('whatsapp_cost_charge_scope', 'allocate_to_order'),
  ('whatsapp_cost_twilio_inbound_usd', '0.005'),
  ('whatsapp_cost_twilio_outbound_usd', '0.005'),
  ('whatsapp_cost_twilio_failed_usd', '0.001'),
  ('whatsapp_cost_meta_service_in_window_usd', '0'),
  ('whatsapp_cost_meta_utility_in_window_usd', '0'),
  ('whatsapp_cost_meta_utility_out_window_usd', '0'),
  ('whatsapp_cost_meta_authentication_usd', '0'),
  ('whatsapp_cost_meta_marketing_usd', '0'),
  ('whatsapp_cost_meta_country', 'NG'),
  ('whatsapp_cost_fx_usd_ngn', '1600'),
  ('whatsapp_cost_fx_source', 'admin_entered'),
  ('whatsapp_cost_fx_buffer_pct', '0'),
  ('whatsapp_cost_pricing_method', 'cost_plus'),
  ('whatsapp_cost_markup_pct', '0'),
  ('whatsapp_cost_fixed_markup_ngn', '0'),
  ('whatsapp_cost_min_fee_ngn', '0'),
  ('whatsapp_cost_max_fee_ngn', '200'),
  ('whatsapp_cost_rounding_ngn', '5'),
  ('whatsapp_cost_free_allowance_ngn_per_order', '0'),
  ('whatsapp_cost_free_allowance_ngn_per_day', '0'),
  ('whatsapp_cost_absorb_guest_browsing', 'true'),
  ('whatsapp_cost_outbound_reserve_messages', '2'),
  ('whatsapp_cost_allocation_lookback_hours', '48'),
  ('whatsapp_cost_quote_ttl_seconds', '900'),
  ('whatsapp_cost_tax_pct', '0'),
  ('whatsapp_cost_config_version', 'v1')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.whatsapp_ai_rate_cards
  (model_id, provider, effective_from, input_usd_per_mtok, output_usd_per_mtok,
   thinking_usd_per_mtok, cached_input_usd_per_mtok, rate_source, is_confirmed, notes)
VALUES
  ('google/gemini-3.8-flash', 'google_public_reference', now(), 0.30, 2.50, 2.50, 0.075,
   'google_public_reference', false,
   'ADMIN REFERENCE ONLY. Public Google Flash-tier pricing; the Lovable AI Gateway billed rate is not confirmed. Costs computed from this card are estimates.'),
  ('google/gemini-3.5-flash', 'google_public_reference', now(), 0.30, 2.50, 2.50, 0.075,
   'google_public_reference', false,
   'ADMIN REFERENCE ONLY - used for voice transcription estimates until the gateway rate is confirmed.')
ON CONFLICT (model_id, provider, effective_from) DO NOTHING;