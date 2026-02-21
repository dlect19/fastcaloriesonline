
-- Drop the existing restrictive policy
DROP POLICY "Anyone can view available combos" ON public.combos;

-- Create new policy that allows anyone to view all combos
CREATE POLICY "Anyone can view combos"
ON public.combos
FOR SELECT
USING (true);
