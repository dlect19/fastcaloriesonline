
-- Create order_packages table
CREATE TABLE public.order_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL DEFAULT 'Default',
  note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add package_id to order_items (nullable for backward compatibility)
ALTER TABLE public.order_items ADD COLUMN package_id UUID REFERENCES public.order_packages(id) ON DELETE SET NULL;

-- Add package tracking columns to orders
ALTER TABLE public.orders ADD COLUMN package_count INT NOT NULL DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN extra_package_fee NUMERIC NOT NULL DEFAULT 0;

-- Enable RLS
ALTER TABLE public.order_packages ENABLE ROW LEVEL SECURITY;

-- RLS policies for order_packages
CREATE POLICY "Users can view their own order packages"
  ON public.order_packages FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_packages.order_id AND orders.user_id = auth.uid())
  );

CREATE POLICY "Users can insert packages for their orders"
  ON public.order_packages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_packages.order_id AND orders.user_id = auth.uid())
  );

-- Vendors can view packages for their orders
CREATE POLICY "Vendors can view order packages"
  ON public.order_packages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.vendors v ON v.id = o.vendor_id
      WHERE o.id = order_packages.order_id AND v.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.vendor_staff vs ON vs.vendor_id = o.vendor_id
      WHERE o.id = order_packages.order_id AND vs.user_id = auth.uid() AND vs.is_active = true
    )
  );

-- Riders can view packages for their assigned orders
CREATE POLICY "Riders can view order packages"
  ON public.order_packages FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_packages.order_id AND orders.rider_id = auth.uid())
  );

-- Admins can view all packages
CREATE POLICY "Admins can view all order packages"
  ON public.order_packages FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
