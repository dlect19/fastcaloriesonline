
CREATE TABLE public.twilio_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  initiated_by uuid,
  direction text NOT NULL DEFAULT 'out',
  channel text NOT NULL,
  to_phone text,
  from_phone text,
  body_preview text,
  twilio_sid text,
  twilio_status text,
  segments integer NOT NULL DEFAULT 1,
  price_ngn numeric(10,2) NOT NULL DEFAULT 0,
  function_name text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.twilio_api_logs TO authenticated;
GRANT ALL ON public.twilio_api_logs TO service_role;

ALTER TABLE public.twilio_api_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view twilio logs"
  ON public.twilio_api_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_twilio_logs_user_id ON public.twilio_api_logs(user_id);
CREATE INDEX idx_twilio_logs_created_at ON public.twilio_api_logs(created_at DESC);
CREATE INDEX idx_twilio_logs_channel ON public.twilio_api_logs(channel);

CREATE OR REPLACE FUNCTION public.is_user_verified(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.user_id = _user_id AND v.is_verified = true
  )
  OR EXISTS (
    SELECT 1 FROM public.rider_profiles r
    WHERE r.user_id = _user_id AND r.is_verified = true
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = _user_id
      AND p.phone_verified = true
      AND u.email IS NOT NULL
      AND u.email <> ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_user_verified(uuid) TO anon, authenticated;
