
-- Drop the old unique constraint that doesn't account for outlet_id
ALTER TABLE public.vendor_working_hours DROP CONSTRAINT IF EXISTS vendor_working_hours_vendor_id_day_of_week_key;

-- Create a new unique constraint that includes outlet_id
CREATE UNIQUE INDEX vendor_working_hours_vendor_outlet_day_key 
ON public.vendor_working_hours (vendor_id, COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid), day_of_week);
