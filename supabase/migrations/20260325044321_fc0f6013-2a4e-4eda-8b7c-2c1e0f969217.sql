-- Make vendor_id nullable in ad_placements so admin can create ads without a vendor
ALTER TABLE public.ad_placements ALTER COLUMN vendor_id DROP NOT NULL;

-- Drop and recreate the FK constraint to allow NULL
ALTER TABLE public.ad_placements DROP CONSTRAINT IF EXISTS ad_placements_vendor_id_fkey;
ALTER TABLE public.ad_placements ADD CONSTRAINT ad_placements_vendor_id_fkey 
  FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

-- Allow admins to insert ad_placements
CREATE POLICY "Admins can manage ad placements"
ON public.ad_placements FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
);