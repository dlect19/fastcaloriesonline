
-- 1) Email send log
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_send_log TO authenticated;
GRANT ALL ON public.email_send_log TO service_role;
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view email log"
ON public.email_send_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_email_send_log_created_at ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_template ON public.email_send_log(template_name);

-- 2) Default category-specific service fee settings (only insert if missing)
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('service_fee_type_pharmacy', 'hybrid', 'Pharmacy order service fee type'),
  ('service_fee_min_pharmacy', '100', 'Pharmacy minimum service fee (NGN)'),
  ('service_fee_percentage_pharmacy', '15', 'Pharmacy service fee percentage'),
  ('service_fee_max_pharmacy', '5000', 'Pharmacy service fee cap (NGN)'),
  ('service_fee_fixed_pharmacy', '100', 'Pharmacy fixed service fee (NGN)'),
  ('service_fee_type_grocery', 'hybrid', 'Grocery/Marketplace order service fee type'),
  ('service_fee_min_grocery', '100', 'Grocery/Marketplace minimum service fee (NGN)'),
  ('service_fee_percentage_grocery', '15', 'Grocery/Marketplace service fee percentage'),
  ('service_fee_max_grocery', '7500', 'Grocery/Marketplace service fee cap (NGN)'),
  ('service_fee_fixed_grocery', '100', 'Grocery/Marketplace fixed service fee (NGN)')
ON CONFLICT (key) DO NOTHING;

-- 3) Admin role management helper
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  _target_user_id UUID,
  _role app_role,
  _action TEXT  -- 'grant' or 'revoke'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _role = 'admin' THEN
    RAISE EXCEPTION 'admin role cannot be assigned via this endpoint';
  END IF;
  IF _action = 'grant' THEN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'action', 'granted', 'role', _role);
  ELSIF _action = 'revoke' THEN
    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = _role;
    RETURN jsonb_build_object('success', true, 'action', 'revoked', 'role', _role);
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, app_role, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, app_role, TEXT) TO authenticated;
