
-- =====================================================
-- PHASE 1: Multi-Outlet System — Database Schema
-- =====================================================

-- 1. Create vendor_outlets table
CREATE TABLE public.vendor_outlets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  outlet_name TEXT NOT NULL DEFAULT 'Main Outlet',
  outlet_surname TEXT,
  outlet_code TEXT NOT NULL DEFAULT 'Store 1',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_open BOOLEAN NOT NULL DEFAULT false,
  
  -- Location fields (outlet-level)
  address TEXT,
  city TEXT,
  state TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  verified_latitude DOUBLE PRECISION,
  verified_longitude DOUBLE PRECISION,
  
  -- Geo-lock (outlet-level)
  geo_verification_status TEXT DEFAULT 'unverified',
  geo_lock_reason TEXT,
  geo_locked_at TIMESTAMPTZ,
  tolerance_radius_m DOUBLE PRECISION DEFAULT 500,
  sales_radius DOUBLE PRECISION DEFAULT 10,
  
  -- Store settings (outlet-level)
  delivery_mode TEXT DEFAULT 'delivery_and_pickup',
  min_order_amount NUMERIC DEFAULT 0,
  estimated_delivery_minutes INTEGER DEFAULT 30,
  
  -- Metadata
  logo_url TEXT,
  banner_url TEXT,
  description TEXT,
  rating NUMERIC DEFAULT 0,
  total_ratings INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast vendor lookup
CREATE INDEX idx_vendor_outlets_vendor_id ON public.vendor_outlets(vendor_id);
CREATE INDEX idx_vendor_outlets_active ON public.vendor_outlets(is_approved, is_active);

-- 2. Enable RLS
ALTER TABLE public.vendor_outlets ENABLE ROW LEVEL SECURITY;

-- Helper function to check outlet ownership
CREATE OR REPLACE FUNCTION public.owns_outlet(_user_id UUID, _outlet_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendor_outlets vo
    JOIN public.vendors v ON v.id = vo.vendor_id
    WHERE vo.id = _outlet_id AND v.user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_outlets vo
    JOIN public.vendor_staff vs ON vs.vendor_id = vo.vendor_id
    WHERE vo.id = _outlet_id AND vs.user_id = _user_id AND vs.is_active = true
  )
$$;

-- RLS Policies
CREATE POLICY "Anyone can view approved active outlets"
ON public.vendor_outlets FOR SELECT
USING (
  (is_approved = true AND is_active = true)
  OR owns_outlet(auth.uid(), id)
  OR has_role(auth.uid(), 'admin')
);

CREATE POLICY "Vendor owners can create outlets"
ON public.vendor_outlets FOR INSERT
WITH CHECK (
  vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())
);

CREATE POLICY "Outlet owners and admins can update"
ON public.vendor_outlets FOR UPDATE
USING (
  owns_outlet(auth.uid(), id) OR has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can delete outlets"
ON public.vendor_outlets FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_outlets;

-- 3. Auto-create Main Outlet for every existing vendor
INSERT INTO public.vendor_outlets (
  vendor_id, outlet_name, outlet_surname, outlet_code, is_default,
  is_approved, is_active, is_open,
  address, city, state, latitude, longitude,
  verified_latitude, verified_longitude,
  geo_verification_status, geo_lock_reason, geo_locked_at,
  tolerance_radius_m, sales_radius,
  delivery_mode, min_order_amount, estimated_delivery_minutes,
  logo_url, banner_url, description, rating, total_ratings
)
SELECT
  v.id,
  'Main Outlet',
  v.city,
  'Store 1',
  true,
  COALESCE(v.is_verified, false),
  COALESCE(v.is_active, false),
  v.is_open,
  v.address, v.city, v.state, v.latitude, v.longitude,
  v.verified_latitude, v.verified_longitude,
  COALESCE(v.geo_verification_status, 'unverified'),
  v.geo_lock_reason, v.geo_locked_at,
  COALESCE(v.tolerance_radius_m, 500),
  COALESCE(v.sales_radius, 10),
  COALESCE(v.delivery_mode, 'delivery_and_pickup'),
  COALESCE(v.min_order_amount, 0),
  COALESCE(v.estimated_delivery_minutes, 30),
  v.logo_url, v.banner_url, v.description, v.rating, v.total_ratings
FROM public.vendors v;

-- 4. Add outlet_id to child tables (nullable for backward compat)

-- Orders
ALTER TABLE public.orders ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Products
ALTER TABLE public.products ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Product Categories
ALTER TABLE public.product_categories ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Combos
ALTER TABLE public.combos ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Addon Groups
ALTER TABLE public.addon_groups ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Takeaway Packs
ALTER TABLE public.takeaway_packs ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Staff
ALTER TABLE public.vendor_staff ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Riders
ALTER TABLE public.vendor_riders ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Working Hours
ALTER TABLE public.vendor_working_hours ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Promo Codes
ALTER TABLE public.promo_codes ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Reviews
ALTER TABLE public.reviews ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Dispatch Requests
ALTER TABLE public.dispatch_requests ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Wallets (for per-outlet wallet tracking)
ALTER TABLE public.wallets ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Wallet Transactions
ALTER TABLE public.wallet_transactions ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Payout Requests
ALTER TABLE public.payout_requests ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Order Financials
ALTER TABLE public.order_financials ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Location Logs
ALTER TABLE public.vendor_location_logs ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Reverification Requests
ALTER TABLE public.vendor_reverification_requests ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- Vendor Rider Invites
ALTER TABLE public.vendor_rider_invites ADD COLUMN outlet_id UUID REFERENCES public.vendor_outlets(id);

-- 5. Backfill outlet_id on ALL existing rows using the default outlet

-- Orders
UPDATE public.orders o
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = o.vendor_id AND vo.is_default = true
AND o.outlet_id IS NULL;

-- Products
UPDATE public.products p
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = p.vendor_id AND vo.is_default = true
AND p.outlet_id IS NULL;

-- Product Categories
UPDATE public.product_categories pc
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = pc.vendor_id AND vo.is_default = true
AND pc.outlet_id IS NULL;

-- Combos
UPDATE public.combos c
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = c.vendor_id AND vo.is_default = true
AND c.outlet_id IS NULL;

-- Addon Groups
UPDATE public.addon_groups ag
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = ag.vendor_id AND vo.is_default = true
AND ag.outlet_id IS NULL;

-- Takeaway Packs
UPDATE public.takeaway_packs tp
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = tp.vendor_id AND vo.is_default = true
AND tp.outlet_id IS NULL;

-- Vendor Staff
UPDATE public.vendor_staff vs
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vs.vendor_id AND vo.is_default = true
AND vs.outlet_id IS NULL;

-- Vendor Riders
UPDATE public.vendor_riders vr
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vr.vendor_id AND vo.is_default = true
AND vr.outlet_id IS NULL;

-- Vendor Working Hours
UPDATE public.vendor_working_hours vwh
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vwh.vendor_id AND vo.is_default = true
AND vwh.outlet_id IS NULL;

-- Promo Codes (only vendor-scoped ones)
UPDATE public.promo_codes pc
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = pc.vendor_id AND vo.is_default = true
AND pc.outlet_id IS NULL AND pc.vendor_id IS NOT NULL;

-- Reviews
UPDATE public.reviews r
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = r.vendor_id AND vo.is_default = true
AND r.outlet_id IS NULL;

-- Dispatch Requests
UPDATE public.dispatch_requests dr
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = dr.vendor_id AND vo.is_default = true
AND dr.outlet_id IS NULL;

-- Wallets (vendor type only)
UPDATE public.wallets w
SET outlet_id = vo.id
FROM public.vendors v
JOIN public.vendor_outlets vo ON vo.vendor_id = v.id AND vo.is_default = true
WHERE w.user_id = v.user_id AND w.wallet_type = 'vendor'
AND w.outlet_id IS NULL;

-- Wallet Transactions (vendor type only)
UPDATE public.wallet_transactions wt
SET outlet_id = w.outlet_id
FROM public.wallets w
WHERE wt.wallet_id = w.id AND w.wallet_type = 'vendor' AND w.outlet_id IS NOT NULL
AND wt.outlet_id IS NULL AND wt.wallet_type = 'vendor';

-- Payout Requests (vendor type only)
UPDATE public.payout_requests pr
SET outlet_id = w.outlet_id
FROM public.wallets w
WHERE pr.wallet_id = w.id AND w.wallet_type = 'vendor' AND w.outlet_id IS NOT NULL
AND pr.outlet_id IS NULL AND pr.user_type = 'vendor';

-- Order Financials
UPDATE public.order_financials of2
SET outlet_id = o.outlet_id
FROM public.orders o
WHERE of2.order_id = o.id AND o.outlet_id IS NOT NULL
AND of2.outlet_id IS NULL;

-- Vendor Location Logs
UPDATE public.vendor_location_logs vll
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vll.vendor_id AND vo.is_default = true
AND vll.outlet_id IS NULL;

-- Vendor Reverification Requests
UPDATE public.vendor_reverification_requests vrr
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vrr.vendor_id AND vo.is_default = true
AND vrr.outlet_id IS NULL;

-- Vendor Rider Invites
UPDATE public.vendor_rider_invites vri
SET outlet_id = vo.id
FROM public.vendor_outlets vo
WHERE vo.vendor_id = vri.vendor_id AND vo.is_default = true
AND vri.outlet_id IS NULL;

-- 6. Create trigger to auto-create Main Outlet on new vendor registration
CREATE OR REPLACE FUNCTION public.auto_create_default_outlet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vendor_outlets (
    vendor_id, outlet_name, outlet_surname, outlet_code, is_default,
    is_approved, is_active, is_open,
    address, city, state, latitude, longitude,
    delivery_mode, logo_url, banner_url, description
  ) VALUES (
    NEW.id, 'Main Outlet', NEW.city, 'Store 1', true,
    COALESCE(NEW.is_verified, false),
    COALESCE(NEW.is_active, false),
    NEW.is_open,
    NEW.address, NEW.city, NEW.state, NEW.latitude, NEW.longitude,
    COALESCE(NEW.delivery_mode, 'delivery_and_pickup'),
    NEW.logo_url, NEW.banner_url, NEW.description
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_default_outlet
AFTER INSERT ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_default_outlet();

-- 7. Create trigger to auto-create wallet for new outlet
CREATE OR REPLACE FUNCTION public.auto_create_outlet_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.vendors WHERE id = NEW.vendor_id;
  
  IF v_user_id IS NOT NULL THEN
    PERFORM set_config('app.bypass_balance_trigger', 'true', true);
    INSERT INTO public.wallets (user_id, wallet_type, outlet_id)
    VALUES (v_user_id, 'vendor', NEW.id)
    ON CONFLICT DO NOTHING;
    PERFORM set_config('app.bypass_balance_trigger', 'false', true);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_outlet_wallet
AFTER INSERT ON public.vendor_outlets
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_outlet_wallet();

-- 8. Helper function to get default outlet for a vendor
CREATE OR REPLACE FUNCTION public.get_default_outlet_id(_vendor_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.vendor_outlets 
  WHERE vendor_id = _vendor_id AND is_default = true 
  LIMIT 1
$$;

-- 9. Add indexes for outlet_id on key tables
CREATE INDEX idx_orders_outlet_id ON public.orders(outlet_id);
CREATE INDEX idx_products_outlet_id ON public.products(outlet_id);
CREATE INDEX idx_wallet_transactions_outlet_id ON public.wallet_transactions(outlet_id);
CREATE INDEX idx_wallets_outlet_id ON public.wallets(outlet_id);
