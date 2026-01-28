-- 1. Add delivery_type column to orders for self-pickup support
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'delivery';

-- Add check constraint for delivery_type
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_type_check'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_type_check 
      CHECK (delivery_type IN ('delivery', 'self_pickup'));
  END IF;
END $$;

-- 2. Create favorites table
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, vendor_id)
);

-- Enable RLS on favorites
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for favorites
CREATE POLICY "Users can manage own favorites" ON public.favorites
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Create function to auto-cancel stale pending orders
-- This function can be called by a scheduled job or cron
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cancelled_count INTEGER;
BEGIN
  -- Cancel orders that are pending for more than 30 minutes without payment
  UPDATE orders
  SET 
    status = 'cancelled',
    cancellation_reason = 'Payment not completed within time limit',
    cancelled_at = NOW()
  WHERE 
    payment_status = 'pending'
    AND status = 'pending'
    AND created_at < NOW() - INTERVAL '30 minutes';
  
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  
  RETURN cancelled_count;
END;
$$;

-- 4. Create a trigger function to check and cancel individual stale orders on update
-- This catches orders when they're being queried/updated
CREATE OR REPLACE FUNCTION public.check_and_cancel_stale_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the order is pending and older than 30 minutes, cancel it
  IF NEW.payment_status = 'pending' 
     AND NEW.status = 'pending' 
     AND NEW.created_at < NOW() - INTERVAL '30 minutes' THEN
    NEW.status := 'cancelled';
    NEW.cancellation_reason := 'Payment not completed within time limit';
    NEW.cancelled_at := NOW();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for stale order check (runs on SELECT via update)
DROP TRIGGER IF EXISTS check_stale_order_trigger ON public.orders;
CREATE TRIGGER check_stale_order_trigger
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_and_cancel_stale_order();