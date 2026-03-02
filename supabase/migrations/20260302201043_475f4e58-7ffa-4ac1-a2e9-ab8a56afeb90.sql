
-- Create disputes table for fault-based refund tracking
CREATE TABLE public.disputes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id),
  order_number TEXT NOT NULL,
  fault_party TEXT NOT NULL CHECK (fault_party IN ('vendor', 'rider', 'platform', 'vendor_and_rider')),
  refund_amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  
  -- Deduction breakdown
  vendor_deduction NUMERIC NOT NULL DEFAULT 0,
  rider_deduction NUMERIC NOT NULL DEFAULT 0,
  platform_deduction NUMERIC NOT NULL DEFAULT 0,
  
  -- Order context (snapshot)
  vendor_id UUID,
  vendor_name TEXT,
  rider_id UUID,
  rider_name TEXT,
  customer_id UUID,
  customer_name TEXT,
  delivery_fee NUMERIC DEFAULT 0,
  order_total NUMERIC DEFAULT 0,
  
  -- Approval tracking
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Wallet transaction references
  customer_refund_reference TEXT,
  vendor_debit_reference TEXT,
  rider_debit_reference TEXT,
  platform_debit_reference TEXT,
  
  environment TEXT NOT NULL DEFAULT 'production',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can manage disputes"
ON public.disputes
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Index for fast order lookups
CREATE INDEX idx_disputes_order_id ON public.disputes(order_id);
CREATE INDEX idx_disputes_created_at ON public.disputes(created_at DESC);
CREATE INDEX idx_disputes_environment ON public.disputes(environment);

-- Trigger for updated_at
CREATE TRIGGER update_disputes_updated_at
BEFORE UPDATE ON public.disputes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
