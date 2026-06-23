ALTER TABLE public.coverage_areas ADD COLUMN IF NOT EXISTS is_coming_soon BOOLEAN NOT NULL DEFAULT false;

GRANT SELECT ON public.coverage_areas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coverage_areas TO authenticated;
GRANT ALL ON public.coverage_areas TO service_role;

DROP POLICY IF EXISTS "Anyone can view active coverage areas" ON public.coverage_areas;
CREATE POLICY "Anyone can view active or coming soon coverage areas"
ON public.coverage_areas
FOR SELECT
TO anon, authenticated
USING (is_active = true OR is_coming_soon = true);