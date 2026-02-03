-- Add INSERT policy for dispatch_offers (service role will handle creation in edge functions)
-- Riders need to be able to see offers created for them

-- Add policy for riders who belong to delivery companies to view offers
CREATE POLICY "Delivery company riders can view own offers" 
ON public.dispatch_offers 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM rider_profiles rp
    WHERE rp.user_id = auth.uid()
    AND rp.id = dispatch_offers.rider_profile_id
  )
);