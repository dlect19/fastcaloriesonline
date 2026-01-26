-- Add confirmation_code column to orders table for delivery verification
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS confirmation_code TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_confirmation_code ON public.orders(confirmation_code) WHERE confirmation_code IS NOT NULL;

-- Update RLS: Allow riders to view orders that are ready for pickup and unassigned (for browsing available orders)
CREATE POLICY "Riders can view unassigned ready orders"
ON public.orders FOR SELECT
USING (
  status = 'ready_for_pickup' 
  AND rider_id IS NULL 
  AND has_role(auth.uid(), 'rider')
);

-- Allow riders to claim/update unassigned orders
CREATE POLICY "Riders can claim unassigned orders"
ON public.orders FOR UPDATE
USING (
  status = 'ready_for_pickup' 
  AND rider_id IS NULL 
  AND has_role(auth.uid(), 'rider')
);