
CREATE TABLE public.ambassador_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  promo_code_used TEXT NOT NULL,
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ambassador_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ambassador registration"
ON public.ambassador_registrations
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admin staff can view all ambassador registrations"
ON public.ambassador_registrations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

CREATE POLICY "Authenticated users can insert their own registration"
ON public.ambassador_registrations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ambassador_registrations_ambassador ON public.ambassador_registrations(ambassador_id);
CREATE INDEX idx_ambassador_registrations_user ON public.ambassador_registrations(user_id);
