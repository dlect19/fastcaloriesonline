
-- =====================================================
-- 1. VEHICLE TYPE CONFIGURATIONS TABLE
-- =====================================================
CREATE TABLE public.vehicle_type_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  max_delivery_distance_km NUMERIC NOT NULL DEFAULT 20,
  base_delivery_rate NUMERIC NOT NULL DEFAULT 500,
  per_km_rate NUMERIC DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_type_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view vehicle configs"
ON public.vehicle_type_configs FOR SELECT USING (true);

CREATE POLICY "Admins can manage vehicle configs"
ON public.vehicle_type_configs FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Seed default vehicle types
INSERT INTO public.vehicle_type_configs (vehicle_type, display_name, max_delivery_distance_km, base_delivery_rate, per_km_rate, sort_order) VALUES
  ('bicycle', 'Bicycle', 5, 300, 80, 1),
  ('bike', 'Bike (Motorcycle)', 15, 500, 100, 2),
  ('tricycle', 'Tricycle', 10, 600, 120, 3),
  ('car', 'Car', 25, 800, 150, 4),
  ('van', 'Van', 30, 1000, 200, 5);

-- =====================================================
-- 2. COMMISSION OVERRIDES TABLE
-- =====================================================
CREATE TABLE public.commission_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vendor', 'rider', 'logistics')),
  entity_id UUID NOT NULL,
  commission_type TEXT NOT NULL DEFAULT 'percentage' CHECK (commission_type IN ('percentage', 'fixed', 'hybrid')),
  percentage_value NUMERIC DEFAULT NULL,
  fixed_value NUMERIC DEFAULT NULL,
  min_value NUMERIC DEFAULT NULL,
  max_value NUMERIC DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

ALTER TABLE public.commission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage commission overrides"
ON public.commission_overrides FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Entities can view own override"
ON public.commission_overrides FOR SELECT
TO authenticated
USING (
  (entity_type = 'vendor' AND entity_id IN (SELECT id FROM vendors WHERE user_id = auth.uid()))
  OR (entity_type = 'rider' AND entity_id IN (SELECT id FROM rider_profiles WHERE user_id = auth.uid()))
  OR (entity_type = 'logistics' AND entity_id IN (SELECT id FROM delivery_companies WHERE user_id = auth.uid()))
);

-- =====================================================
-- 3. SERVICE FEE SETTINGS (platform_settings entries)
-- =====================================================
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('service_fee_type', 'fixed', 'Service fee type: fixed, percentage, or hybrid'),
  ('service_fee_fixed', '100', 'Fixed service fee amount in Naira'),
  ('service_fee_percentage', '5', 'Service fee percentage of order amount'),
  ('service_fee_min', '100', 'Minimum service fee for hybrid mode'),
  ('service_fee_max', '1000', 'Maximum service fee for hybrid mode')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- 4. ADD RIDER/LOGISTICS COMMISSION COLUMNS TO ORDER_FINANCIALS
-- =====================================================
ALTER TABLE public.order_financials
  ADD COLUMN IF NOT EXISTS rider_commission_percentage NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rider_commission_amount NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS logistics_commission_percentage NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS logistics_commission_amount NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS service_fee_amount NUMERIC DEFAULT 0;

-- =====================================================
-- 5. FUNCTION TO RESOLVE COMMISSION RATE
-- =====================================================
CREATE OR REPLACE FUNCTION public.resolve_commission_rate(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override RECORD;
  v_default_rate NUMERIC;
  v_default_key TEXT;
BEGIN
  -- Check for personal override first
  SELECT * INTO v_override FROM commission_overrides
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  IF FOUND THEN
    IF v_override.commission_type = 'percentage' THEN
      RETURN COALESCE(v_override.percentage_value, 15);
    ELSIF v_override.commission_type = 'fixed' THEN
      RETURN COALESCE(v_override.fixed_value, 0);
    ELSIF v_override.commission_type = 'hybrid' THEN
      RETURN COALESCE(v_override.percentage_value, 15);
    END IF;
  END IF;

  -- Fall back to global default
  IF p_entity_type = 'vendor' THEN
    v_default_key := 'default_vendor_commission_rate';
  ELSIF p_entity_type = 'rider' THEN
    v_default_key := 'rider_platform_fee_pct';
  ELSIF p_entity_type = 'logistics' THEN
    v_default_key := 'default_delivery_company_commission_rate';
  ELSE
    RETURN 15;
  END IF;

  SELECT value::NUMERIC INTO v_default_rate FROM platform_settings WHERE key = v_default_key;
  RETURN COALESCE(v_default_rate, 15);
END;
$$;
