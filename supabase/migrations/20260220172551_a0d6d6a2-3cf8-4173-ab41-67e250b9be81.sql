
-- Table to manage vendor commission promotions
CREATE TABLE public.vendor_commission_promos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  promo_commission_rate NUMERIC NOT NULL,
  normal_commission_rate NUMERIC NOT NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vendor_commission_promos ENABLE ROW LEVEL SECURITY;

-- Only admins can manage
CREATE POLICY "Admins can manage vendor commission promos"
ON public.vendor_commission_promos
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Vendors can view their own promos
CREATE POLICY "Vendors can view own commission promos"
ON public.vendor_commission_promos
FOR SELECT
USING (vendor_id IN (SELECT id FROM vendors WHERE user_id = auth.uid()));

-- Function to auto-apply/revert commission rates based on promo dates
CREATE OR REPLACE FUNCTION public.apply_vendor_commission_promos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Apply promo rate for active promos that have started
  UPDATE vendors v
  SET commission_rate = vcp.promo_commission_rate,
      updated_at = now()
  FROM vendor_commission_promos vcp
  WHERE v.id = vcp.vendor_id
    AND vcp.is_active = true
    AND CURRENT_DATE >= vcp.start_date
    AND CURRENT_DATE <= vcp.end_date
    AND v.commission_rate != vcp.promo_commission_rate;

  -- Revert to normal rate for expired promos
  UPDATE vendors v
  SET commission_rate = vcp.normal_commission_rate,
      updated_at = now()
  FROM vendor_commission_promos vcp
  WHERE v.id = vcp.vendor_id
    AND vcp.is_active = true
    AND CURRENT_DATE > vcp.end_date
    AND v.commission_rate = vcp.promo_commission_rate;

  -- Deactivate expired promos
  UPDATE vendor_commission_promos
  SET is_active = false, updated_at = now()
  WHERE is_active = true AND CURRENT_DATE > end_date;
END;
$$;
