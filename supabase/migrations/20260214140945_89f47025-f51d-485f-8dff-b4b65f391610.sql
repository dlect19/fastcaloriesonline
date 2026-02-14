-- Payroll employees table (links to admin_staff)
CREATE TABLE public.payroll_employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_staff_id UUID NOT NULL REFERENCES public.admin_staff(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  base_salary NUMERIC NOT NULL DEFAULT 0,
  bank_account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  paystack_recipient_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(admin_staff_id)
);

-- Payroll runs table
CREATE TABLE public.payroll_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'failed', 'partial')),
  total_gross NUMERIC NOT NULL DEFAULT 0,
  total_deductions NUMERIC NOT NULL DEFAULT 0,
  total_net NUMERIC NOT NULL DEFAULT 0,
  total_employees INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID NOT NULL,
  processed_at TIMESTAMPTZ,
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payroll items (individual payments within a run)
CREATE TABLE public.payroll_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_employee_id UUID NOT NULL REFERENCES public.payroll_employees(id),
  employee_name TEXT NOT NULL,
  base_salary NUMERIC NOT NULL DEFAULT 0,
  bonus NUMERIC NOT NULL DEFAULT 0,
  bonus_note TEXT,
  deductions NUMERIC NOT NULL DEFAULT 0,
  deduction_note TEXT,
  net_pay NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  paystack_reference TEXT,
  paystack_transfer_code TEXT,
  failure_reason TEXT,
  bank_account_number TEXT,
  bank_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only admin staff with super_admin role can access payroll
CREATE POLICY "Super admins can manage payroll employees"
  ON public.payroll_employees FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.admin_staff 
    WHERE user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  ));

CREATE POLICY "Super admins can manage payroll runs"
  ON public.payroll_runs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.admin_staff 
    WHERE user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  ));

CREATE POLICY "Super admins can manage payroll items"
  ON public.payroll_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.admin_staff 
    WHERE user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  ));

-- Indexes
CREATE INDEX idx_payroll_items_run ON public.payroll_items(payroll_run_id);
CREATE INDEX idx_payroll_items_employee ON public.payroll_items(payroll_employee_id);
CREATE INDEX idx_payroll_runs_status ON public.payroll_runs(status);
CREATE INDEX idx_payroll_employees_active ON public.payroll_employees(is_active);