-- Additive canary rollout controls for server-authoritative customer checkout.

CREATE TABLE IF NOT EXISTS public.server_checkout_rollout_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  eligible boolean NOT NULL,
  cohort integer,
  reason text NOT NULL,
  route text,
  payment_method text,
  channel text,
  client_version text,
  checkout_attempt_key text,
  failure_code text
);

GRANT SELECT ON public.server_checkout_rollout_decisions TO authenticated;
GRANT ALL ON public.server_checkout_rollout_decisions TO service_role;
ALTER TABLE public.server_checkout_rollout_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read server checkout rollout decisions" ON public.server_checkout_rollout_decisions;
CREATE POLICY "Admins read server checkout rollout decisions"
  ON public.server_checkout_rollout_decisions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS server_checkout_rollout_decisions_created_idx
  ON public.server_checkout_rollout_decisions (created_at DESC);

-- Numeric, segment-wise version comparison (never lexical).
CREATE OR REPLACE FUNCTION public.server_checkout_version_at_least(p_version text, p_minimum text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE a int[]; b int[]; i int; n int;
BEGIN
  IF p_minimum IS NULL OR btrim(p_minimum) = '' THEN RETURN true; END IF;
  IF p_version IS NULL OR btrim(p_version) = '' THEN RETURN false; END IF;
  SELECT array_agg(COALESCE(NULLIF(regexp_replace(s, '[^0-9]', '', 'g'), ''), '0')::int ORDER BY o)
    INTO a
    FROM unnest(string_to_array(split_part(btrim(p_version), '-', 1), '.')) WITH ORDINALITY t(s, o);
  SELECT array_agg(COALESCE(NULLIF(regexp_replace(s, '[^0-9]', '', 'g'), ''), '0')::int ORDER BY o)
    INTO b
    FROM unnest(string_to_array(split_part(btrim(p_minimum), '-', 1), '.')) WITH ORDINALITY t(s, o);
  n := GREATEST(COALESCE(array_length(a, 1), 0), COALESCE(array_length(b, 1), 0));
  FOR i IN 1..n LOOP
    IF COALESCE(a[i], 0) > COALESCE(b[i], 0) THEN RETURN true; END IF;
    IF COALESCE(a[i], 0) < COALESCE(b[i], 0) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Deterministic, server-side eligibility. The caller may never name another user.
CREATE OR REPLACE FUNCTION public.get_server_checkout_rollout(
  p_client_version text DEFAULT NULL,
  p_payment_method text DEFAULT 'wallet',
  p_channel text DEFAULT 'online'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  s jsonb;
  master boolean;
  canary boolean;
  pct int;
  minv text;
  wallet_ok boolean;
  external_ok boolean;
  allow jsonb;
  allowlisted boolean := false;
  cohort int;
  method text := lower(btrim(COALESCE(p_payment_method, '')));
  chan text := lower(btrim(COALESCE(p_channel, 'online')));
  v_eligible boolean := false;
  v_reason text;
  v_route text;

  FUNCTION_BODY_MARKER text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'route', 'compatibility', 'reason', 'NOT_AUTHENTICATED');
  END IF;

  SELECT jsonb_object_agg(key, value) INTO s
    FROM public.platform_settings
   WHERE key IN (
     'enforce_server_checkout',
     'server_checkout_canary_enabled',
     'server_checkout_canary_percent',
     'server_checkout_canary_user_ids',
     'server_checkout_min_client_version',
     'server_checkout_wallet_enabled',
     'server_checkout_external_payment_enabled'
   );
  s := COALESCE(s, '{}'::jsonb);

  master := COALESCE(s->>'enforce_server_checkout', 'false') = 'true';
  canary := COALESCE(s->>'server_checkout_canary_enabled', 'false') = 'true';
  pct := GREATEST(0, LEAST(100, COALESCE(NULLIF(regexp_replace(COALESCE(s->>'server_checkout_canary_percent', '0'), '[^0-9]', '', 'g'), ''), '0')::int));
  minv := NULLIF(btrim(COALESCE(s->>'server_checkout_min_client_version', '')), '');
  wallet_ok := COALESCE(s->>'server_checkout_wallet_enabled', 'true') = 'true';
  external_ok := COALESCE(s->>'server_checkout_external_payment_enabled', 'false') = 'true';

  BEGIN
    allow := COALESCE(NULLIF(btrim(COALESCE(s->>'server_checkout_canary_user_ids', '')), ''), '[]')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    allow := '[]'::jsonb;
  END;
  IF jsonb_typeof(allow) = 'array' THEN
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(allow) e WHERE lower(btrim(e)) = uid::text
    ) INTO allowlisted;
  END IF;

  cohort := ((hashtextextended('server-checkout-canary:' || uid::text, 0) % 100) + 100) % 100;

  -- POS, assisted and WhatsApp keep their existing, separately authorised routes.
  IF chan <> 'online' THEN
    RETURN jsonb_build_object('eligible', false, 'route', 'existing', 'reason', 'CHANNEL_UNSUPPORTED',
      'cohort', cohort, 'master_enforced', master, 'canary_enabled', canary, 'canary_percent', pct);
  END IF;

  IF method = 'wallet' AND NOT wallet_ok THEN
    v_reason := 'WALLET_CHECKOUT_DISABLED';
  ELSIF method IN ('card', 'bank', 'transfer', 'bank_transfer', 'paystack') AND NOT external_ok THEN
    v_reason := 'EXTERNAL_PAYMENT_DISABLED';
  ELSIF method NOT IN ('wallet', 'card', 'bank', 'transfer', 'bank_transfer', 'paystack') THEN
    v_reason := 'PAYMENT_METHOD_UNSUPPORTED';
  ELSIF NOT public.server_checkout_version_at_least(p_client_version, minv) THEN
    v_reason := 'CLIENT_VERSION_TOO_OLD';
  END IF;

  IF v_reason IS NOT NULL THEN
    v_route := CASE WHEN master THEN 'blocked' ELSE 'compatibility' END;
    RETURN jsonb_build_object('eligible', false, 'route', v_route, 'reason', v_reason,
      'cohort', cohort, 'master_enforced', master, 'canary_enabled', canary, 'canary_percent', pct,
      'wallet_enabled', wallet_ok, 'external_payment_enabled', external_ok,
      'min_client_version', minv, 'allowlisted', allowlisted);
  END IF;

  IF master THEN
    v_eligible := true; v_reason := 'MASTER_ENFORCED';
  ELSIF NOT canary THEN
    v_eligible := false; v_reason := 'CANARY_DISABLED';
  ELSIF allowlisted THEN
    v_eligible := true; v_reason := 'ALLOWLISTED';
  ELSIF cohort < pct THEN
    v_eligible := true; v_reason := 'COHORT_INCLUDED';
  ELSE
    v_eligible := false; v_reason := 'COHORT_EXCLUDED';
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'route', CASE WHEN v_eligible THEN 'server' ELSE 'compatibility' END,
    'reason', v_reason,
    'cohort', cohort,
    'master_enforced', master,
    'canary_enabled', canary,
    'canary_percent', pct,
    'wallet_enabled', wallet_ok,
    'external_payment_enabled', external_ok,
    'min_client_version', minv,
    'allowlisted', allowlisted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_server_checkout_rollout(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_server_checkout_rollout(text, text, text) TO authenticated, service_role;

-- Observability: which route a checkout actually used, and how it ended.
CREATE OR REPLACE FUNCTION public.log_server_checkout_decision(
  p_route text,
  p_reason text,
  p_eligible boolean,
  p_cohort int DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_client_version text DEFAULT NULL,
  p_attempt_key text DEFAULT NULL,
  p_failure_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.server_checkout_rollout_decisions
    (user_id, eligible, cohort, reason, route, payment_method, channel, client_version, checkout_attempt_key, failure_code)
  VALUES (auth.uid(), COALESCE(p_eligible, false), p_cohort, left(COALESCE(p_reason, 'UNKNOWN'), 80), left(p_route, 40),
          left(p_payment_method, 40), left(p_channel, 40), left(p_client_version, 40), left(p_attempt_key, 200), left(p_failure_code, 120));
END;
$$;

REVOKE ALL ON FUNCTION public.log_server_checkout_decision(text, text, boolean, int, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_server_checkout_decision(text, text, boolean, int, text, text, text, text, text) TO authenticated, service_role;

-- Admin-only, audited rollout control. Cannot touch the emergency master flag.
CREATE OR REPLACE FUNCTION public.admin_update_server_checkout_rollout(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  k text; v text; old_v text;
  allowed text[] := ARRAY[
    'server_checkout_canary_enabled',
    'server_checkout_canary_percent',
    'server_checkout_canary_user_ids',
    'server_checkout_min_client_version',
    'server_checkout_wallet_enabled',
    'server_checkout_external_payment_enabled'
  ];
  booleans text[] := ARRAY[
    'server_checkout_canary_enabled',
    'server_checkout_wallet_enabled',
    'server_checkout_external_payment_enabled'
  ];
  changed jsonb := '[]'::jsonb;
  parsed jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_settings) LOOP
    IF NOT (k = ANY(allowed)) THEN RAISE EXCEPTION 'SETTING_NOT_ALLOWED: %', k; END IF;
    IF k = ANY(booleans) AND COALESCE(v, '') NOT IN ('true', 'false') THEN RAISE EXCEPTION 'INVALID_BOOLEAN: %', k; END IF;
    IF k = 'server_checkout_canary_percent' THEN
      IF COALESCE(v, '') !~ '^[0-9]{1,3}$' OR v::int > 100 THEN RAISE EXCEPTION 'INVALID_PERCENT'; END IF;
    END IF;
    IF k = 'server_checkout_canary_user_ids' THEN
      BEGIN
        parsed := COALESCE(NULLIF(btrim(COALESCE(v, '')), ''), '[]')::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'INVALID_ALLOWLIST';
      END;
      IF jsonb_typeof(parsed) <> 'array' THEN RAISE EXCEPTION 'INVALID_ALLOWLIST'; END IF;
      PERFORM (SELECT count(e::uuid) FROM jsonb_array_elements_text(parsed) e);
      v := parsed::text;
    END IF;
    IF k = 'server_checkout_min_client_version' AND COALESCE(v, '') <> ''
       AND v !~ '^[0-9]+(\.[0-9]+){0,3}$' THEN
      RAISE EXCEPTION 'INVALID_VERSION';
    END IF;

    SELECT value INTO old_v FROM public.platform_settings WHERE key = k;
    INSERT INTO public.platform_settings (key, value, description)
    VALUES (k, v, 'Server-authoritative checkout canary control')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    INSERT INTO public.platform_settings_audit (setting_key, old_value, new_value, changed_by, action)
    VALUES (k, old_v, v, auth.uid(), 'update');

    changed := changed || jsonb_build_object('key', k, 'old', old_v, 'new', v);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'changed', changed);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_server_checkout_rollout(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_server_checkout_rollout(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_disable_server_checkout_canary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.admin_update_server_checkout_rollout(jsonb_build_object(
    'server_checkout_canary_enabled', 'false',
    'server_checkout_canary_percent', '0'
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_disable_server_checkout_canary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_disable_server_checkout_canary() TO authenticated, service_role;
