-- =====================================================================
-- 1. STEP-UP VERIFICATION TOKENS (server-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_step_up_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_step_up_tokens TO service_role;
ALTER TABLE public.admin_step_up_tokens ENABLE ROW LEVEL SECURITY;
-- No client policies on purpose: only service_role / SECURITY DEFINER functions may touch this table.

CREATE INDEX IF NOT EXISTS idx_step_up_actor ON public.admin_step_up_tokens(actor_id, action);
CREATE INDEX IF NOT EXISTS idx_step_up_expires ON public.admin_step_up_tokens(expires_at);

-- Replay protection for authenticator codes (per admin)
ALTER TABLE public.admin_2fa_settings
  ADD COLUMN IF NOT EXISTS last_totp_counter bigint;

-- =====================================================================
-- 2. APPEND-ONLY SENSITIVE AUDIT TRAIL
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_sensitive_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  actor_email text,
  actor_name text,
  action text NOT NULL,
  category text NOT NULL DEFAULT 'security',
  target_type text,
  target_id text,
  target_label text,
  old_value jsonb,
  new_value jsonb,
  amount numeric,
  currency text DEFAULT 'NGN',
  environment text,
  reference text,
  reason text,
  ip_address text,
  user_agent text,
  outcome text NOT NULL DEFAULT 'pending',
  error_message text,
  auth_method text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_sensitive_audit TO authenticated;
GRANT ALL ON public.admin_sensitive_audit TO service_role;
ALTER TABLE public.admin_sensitive_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can read sensitive audit" ON public.admin_sensitive_audit;
CREATE POLICY "Super admins can read sensitive audit"
ON public.admin_sensitive_audit FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sensitive_audit_created ON public.admin_sensitive_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensitive_audit_actor ON public.admin_sensitive_audit(actor_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_audit_action ON public.admin_sensitive_audit(action);
CREATE INDEX IF NOT EXISTS idx_sensitive_audit_target ON public.admin_sensitive_audit(target_type, target_id);

-- Immutability: no updates/deletes, ever (including service_role)
CREATE OR REPLACE FUNCTION public.admin_sensitive_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'admin_sensitive_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_sensitive_audit_immutable ON public.admin_sensitive_audit;
CREATE TRIGGER trg_sensitive_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_sensitive_audit
FOR EACH ROW EXECUTE FUNCTION public.admin_sensitive_audit_immutable();

-- =====================================================================
-- 3. PROTECTED / ROOT SUPER ADMIN
-- =====================================================================
ALTER TABLE public.admin_staff
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

-- Mark the oldest active super_admin as the protected root account (idempotent)
UPDATE public.admin_staff s
SET is_protected = true
WHERE s.id = (
  SELECT id FROM public.admin_staff
  WHERE role = 'super_admin' AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.admin_staff WHERE is_protected = true);

CREATE OR REPLACE FUNCTION public.is_protected_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = _user_id AND is_protected = true
  );
$$;

-- Only one protected record allowed
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_staff_single_protected
  ON public.admin_staff((is_protected)) WHERE is_protected = true;

CREATE OR REPLACE FUNCTION public.guard_admin_staff_protection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_protected THEN
      RAISE EXCEPTION 'The protected root super admin cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_protected THEN
    IF NEW.is_protected = false THEN
      RAISE EXCEPTION 'The protected flag on the root super admin cannot be removed';
    END IF;
    IF NEW.role <> 'super_admin'::admin_staff_role THEN
      RAISE EXCEPTION 'The protected root super admin cannot be demoted';
    END IF;
    IF NEW.is_active = false THEN
      RAISE EXCEPTION 'The protected root super admin cannot be deactivated';
    END IF;
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'The protected root super admin cannot be reassigned';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_admin_staff_protection ON public.admin_staff;
CREATE TRIGGER trg_guard_admin_staff_protection
BEFORE UPDATE OR DELETE ON public.admin_staff
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_staff_protection();

-- Never allow zero active super admins
CREATE OR REPLACE FUNCTION public.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.admin_staff
  WHERE role = 'super_admin'::admin_staff_role AND is_active = true;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Operation refused: the platform must always have at least one active super admin';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_last_super_admin ON public.admin_staff;
CREATE TRIGGER trg_guard_last_super_admin
AFTER UPDATE OR DELETE ON public.admin_staff
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_last_super_admin();

-- Protect the root super admin's platform admin role row
CREATE OR REPLACE FUNCTION public.guard_protected_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin'::app_role AND public.is_protected_super_admin(OLD.user_id) THEN
      RAISE EXCEPTION 'The protected root super admin cannot have admin access revoked';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role = 'admin'::app_role AND NEW.role <> 'admin'::app_role
     AND public.is_protected_super_admin(OLD.user_id) THEN
    RAISE EXCEPTION 'The protected root super admin cannot have admin access changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_protected_admin_role ON public.user_roles;
CREATE TRIGGER trg_guard_protected_admin_role
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_protected_admin_role();

-- =====================================================================
-- 4. LOCK DOWN DIRECT PRIVILEGED CLIENT WRITES
-- =====================================================================

-- 4a. user_roles: remove blanket admin write access
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can insert own rider role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can self assign non admin roles" ON public.user_roles;
CREATE POLICY "Users can self assign non admin roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role IN ('customer'::app_role, 'rider'::app_role, 'vendor'::app_role,
               'delivery_company'::app_role, 'event_organizer'::app_role)
);

-- 4b. admin_2fa_settings: authenticator secrets are private to their owner
DROP POLICY IF EXISTS "own 2fa settings" ON public.admin_2fa_settings;
CREATE POLICY "own 2fa settings"
ON public.admin_2fa_settings FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 4c. platform_settings: protected keys cannot be written from a browser session
CREATE OR REPLACE FUNCTION public.guard_protected_platform_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := COALESCE(NEW.key, OLD.key);
BEGIN
  IF v_key IN ('platform_environment', 'admin_role_permissions')
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Setting "%" can only be changed through the verified admin security flow', v_key;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_protected_platform_settings ON public.platform_settings;
CREATE TRIGGER trg_guard_protected_platform_settings
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_protected_platform_settings();

-- =====================================================================
-- 5. STEP-UP CONSUMPTION HELPER + WALLET ADJUSTMENT ENFORCEMENT
-- =====================================================================
CREATE OR REPLACE FUNCTION public.consume_admin_step_up(
  p_token text,
  p_action text,
  p_target_type text DEFAULT NULL,
  p_target_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_hash text;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Step-up verification requires an authenticated admin';
  END IF;
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RAISE EXCEPTION 'Authenticator verification required for this action';
  END IF;

  v_hash := encode(sha256(p_token::bytea), 'hex');

  UPDATE public.admin_step_up_tokens
  SET consumed_at = now()
  WHERE token_hash = v_hash
    AND actor_id = v_actor
    AND action = p_action
    AND consumed_at IS NULL
    AND expires_at > now()
    AND (target_id IS NULL OR p_target_id IS NULL OR target_id = p_target_id)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Authenticator verification invalid, expired, or already used';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_admin_step_up(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_admin_step_up(text, text, text, text) TO authenticated, service_role;

-- Manual wallet adjustments now require a fresh authenticator step-up
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet_balance(
  p_wallet_id uuid,
  p_amount numeric,
  p_adjust_type text,
  p_notes text DEFAULT ''::text,
  p_environment text DEFAULT 'production'::text,
  p_reference text DEFAULT NULL::text,
  p_step_up_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NOT NULL THEN
    IF NOT has_role(v_caller_id, 'admin'::app_role) THEN
      RAISE EXCEPTION 'Unauthorized: admin access required';
    END IF;

    -- Fresh authenticator (TOTP) step-up is mandatory for money movement
    PERFORM public.consume_admin_step_up(
      p_step_up_token,
      CASE WHEN p_adjust_type = 'credit' THEN 'wallet_credit' ELSE 'wallet_debit' END,
      'wallet',
      p_wallet_id::text
    );
  END IF;

  RETURN public.admin_adjust_wallet_balance_internal(
    p_wallet_id, p_amount, p_adjust_type, p_notes, p_environment, p_reference
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_wallet_balance(uuid, numeric, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet_balance(uuid, numeric, text, text, text, text, text) TO authenticated, service_role;
