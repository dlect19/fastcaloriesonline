-- Allow all authenticated users to SELECT active ad placements (for viewing ads)
CREATE POLICY "All users can view active ad placements"
ON public.ad_placements
FOR SELECT
TO authenticated
USING (status = 'active');