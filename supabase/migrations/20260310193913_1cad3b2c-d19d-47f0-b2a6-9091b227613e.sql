
CREATE TABLE public.coverage_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  polygon JSONB NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '#FF8C00',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coverage_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage coverage areas"
ON public.coverage_areas
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view active coverage areas"
ON public.coverage_areas
FOR SELECT
TO anon, authenticated
USING (is_active = true);
