-- Create table to track order reassignments with earnings split
CREATE TABLE public.order_reassignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  original_rider_id UUID NOT NULL,
  new_rider_id UUID NOT NULL,
  reason TEXT,
  original_rider_share NUMERIC NOT NULL DEFAULT 0.3, -- 30% for partial work
  new_rider_share NUMERIC NOT NULL DEFAULT 0.7, -- 70% for completing
  reassigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.order_reassignments ENABLE ROW LEVEL SECURITY;

-- Riders can view reassignments they're involved in
CREATE POLICY "Riders can view own reassignments"
ON public.order_reassignments FOR SELECT
USING (auth.uid() = original_rider_id OR auth.uid() = new_rider_id);

-- Riders can create reassignments for orders they're assigned to
CREATE POLICY "Riders can create reassignments"
ON public.order_reassignments FOR INSERT
WITH CHECK (auth.uid() = original_rider_id);

-- Admins can manage all reassignments
CREATE POLICY "Admins can manage reassignments"
ON public.order_reassignments FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add index for faster lookups
CREATE INDEX idx_order_reassignments_order_id ON public.order_reassignments(order_id);
CREATE INDEX idx_order_reassignments_riders ON public.order_reassignments(original_rider_id, new_rider_id);

-- Enable realtime for order reassignments
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_reassignments;