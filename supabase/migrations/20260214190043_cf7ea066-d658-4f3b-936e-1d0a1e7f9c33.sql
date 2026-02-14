
-- Create expense requisitions table
CREATE TABLE public.expense_requisitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT 'general',
  
  -- Bank account details for payment
  bank_name TEXT,
  bank_code TEXT,
  account_number TEXT,
  account_name TEXT,
  
  -- Requester info
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requested_by_name TEXT NOT NULL,
  
  -- Approval workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id),
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Payment info
  payment_method TEXT CHECK (payment_method IN ('paystack', 'manual')),
  paystack_reference TEXT,
  paystack_transfer_code TEXT,
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES auth.users(id),
  payment_note TEXT,
  
  -- Environment
  environment TEXT NOT NULL DEFAULT 'development',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expense_requisitions ENABLE ROW LEVEL SECURITY;

-- Admin staff can view all requisitions
CREATE POLICY "Admin staff can view all requisitions"
ON public.expense_requisitions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Admin staff can create requisitions (configurable via role permissions)
CREATE POLICY "Admin staff can create requisitions"
ON public.expense_requisitions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = requested_by
  AND EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Admin staff can update requisitions (for approval/payment)
CREATE POLICY "Admin staff can update requisitions"
ON public.expense_requisitions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Create index for performance
CREATE INDEX idx_expense_requisitions_status ON public.expense_requisitions(status);
CREATE INDEX idx_expense_requisitions_environment ON public.expense_requisitions(environment);
CREATE INDEX idx_expense_requisitions_requested_by ON public.expense_requisitions(requested_by);

-- Trigger for updated_at
CREATE TRIGGER update_expense_requisitions_updated_at
BEFORE UPDATE ON public.expense_requisitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_requisitions;
