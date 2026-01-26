-- Create vendor staff roles enum
CREATE TYPE vendor_staff_role AS ENUM ('owner', 'manager', 'cashier', 'viewer');

-- Create admin staff roles enum
CREATE TYPE admin_staff_role AS ENUM ('super_admin', 'admin', 'support', 'analyst');

-- Create vendor staff table
CREATE TABLE public.vendor_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role vendor_staff_role NOT NULL DEFAULT 'viewer',
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  invited_by UUID,
  invite_email TEXT,
  invite_accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(vendor_id, user_id)
);

-- Create admin staff table
CREATE TABLE public.admin_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  role admin_staff_role NOT NULL DEFAULT 'support',
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create activity logs table for audit trail
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.vendor_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Security definer function to check vendor staff role
CREATE OR REPLACE FUNCTION public.get_vendor_staff_role(_user_id UUID, _vendor_id UUID)
RETURNS vendor_staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.vendor_staff
  WHERE user_id = _user_id AND vendor_id = _vendor_id AND is_active = true
  LIMIT 1
$$;

-- Security definer function to check if user is vendor owner
CREATE OR REPLACE FUNCTION public.is_vendor_owner(_user_id UUID, _vendor_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendor_staff
    WHERE user_id = _user_id AND vendor_id = _vendor_id AND role = 'owner' AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.vendors
    WHERE id = _vendor_id AND user_id = _user_id
  )
$$;

-- Security definer function to check admin staff role
CREATE OR REPLACE FUNCTION public.get_admin_staff_role(_user_id UUID)
RETURNS admin_staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.admin_staff
  WHERE user_id = _user_id AND is_active = true
  LIMIT 1
$$;

-- Security definer function to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = _user_id AND role = 'super_admin' AND is_active = true
  )
$$;

-- RLS Policies for vendor_staff
CREATE POLICY "Vendor owners can manage staff"
ON public.vendor_staff FOR ALL
USING (is_vendor_owner(auth.uid(), vendor_id));

CREATE POLICY "Staff can view own record"
ON public.vendor_staff FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policies for admin_staff
CREATE POLICY "Super admins can manage admin staff"
ON public.admin_staff FOR ALL
USING (is_super_admin(auth.uid()));

CREATE POLICY "Admin staff can view own record"
ON public.admin_staff FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policies for activity_logs
CREATE POLICY "Users can view own activity logs"
ON public.activity_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Vendor owners can view staff activity"
ON public.activity_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.vendor_staff vs
    WHERE vs.user_id = activity_logs.user_id
    AND is_vendor_owner(auth.uid(), vs.vendor_id)
  )
);

CREATE POLICY "Super admins can view all logs"
ON public.activity_logs FOR SELECT
USING (is_super_admin(auth.uid()));

CREATE POLICY "Users can insert own logs"
ON public.activity_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_vendor_staff_updated_at
BEFORE UPDATE ON public.vendor_staff
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_admin_staff_updated_at
BEFORE UPDATE ON public.admin_staff
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();