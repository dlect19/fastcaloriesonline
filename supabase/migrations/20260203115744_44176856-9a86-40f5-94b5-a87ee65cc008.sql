-- Add new order status for dispatch system
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'searching_for_rider' AFTER 'ready_for_pickup';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'assigned' AFTER 'searching_for_rider';

-- Create dispatch_requests table
CREATE TABLE IF NOT EXISTS public.dispatch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  vendor_id UUID REFERENCES public.vendors(id) NOT NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled', 'no_riders')),
  
  -- Location data (cached from order/vendor)
  vendor_latitude NUMERIC NOT NULL,
  vendor_longitude NUMERIC NOT NULL,
  customer_latitude NUMERIC,
  customer_longitude NUMERIC,
  
  -- Dispatch configuration
  search_radius_km NUMERIC DEFAULT 5,
  priority_tier TEXT DEFAULT 'vendor_riders' CHECK (priority_tier IN ('vendor_riders', 'delivery_company_riders', 'platform_riders')),
  delivery_fee NUMERIC NOT NULL DEFAULT 0,
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  
  -- Assignment result
  accepted_by_rider_id UUID,
  accepted_by_rider_profile_id UUID REFERENCES public.rider_profiles(id),
  
  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Environment
  environment TEXT DEFAULT 'production',
  
  UNIQUE(order_id)
);

-- Create dispatch_offers table
CREATE TABLE IF NOT EXISTS public.dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id UUID REFERENCES public.dispatch_requests(id) ON DELETE CASCADE NOT NULL,
  rider_user_id UUID NOT NULL,
  rider_profile_id UUID REFERENCES public.rider_profiles(id) NOT NULL,
  
  -- Offer details
  distance_km NUMERIC NOT NULL,
  delivery_fee NUMERIC NOT NULL,
  rider_share NUMERIC NOT NULL,
  priority_tier TEXT NOT NULL CHECK (priority_tier IN ('vendor_riders', 'delivery_company_riders', 'platform_riders')),
  
  -- Vendor info for rider display
  vendor_name TEXT,
  vendor_address TEXT,
  
  -- Customer info for rider display
  customer_address TEXT,
  
  -- ETA prediction
  estimated_pickup_minutes INTEGER,
  estimated_delivery_minutes INTEGER,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  
  -- Prevent duplicate offers
  UNIQUE(dispatch_request_id, rider_user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_order_id ON public.dispatch_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_vendor_id ON public.dispatch_requests(vendor_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_status ON public.dispatch_requests(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_expires_at ON public.dispatch_requests(expires_at);

CREATE INDEX IF NOT EXISTS idx_dispatch_offers_dispatch_request_id ON public.dispatch_offers(dispatch_request_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_rider_user_id ON public.dispatch_offers(rider_user_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_status ON public.dispatch_offers(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_expires_at ON public.dispatch_offers(expires_at);

-- Enable RLS
ALTER TABLE public.dispatch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dispatch_requests
CREATE POLICY "Vendors can view own dispatch requests" 
ON public.dispatch_requests 
FOR SELECT 
USING (owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Admins can manage all dispatch requests" 
ON public.dispatch_requests 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for dispatch_offers
CREATE POLICY "Riders can view own offers" 
ON public.dispatch_offers 
FOR SELECT 
USING (auth.uid() = rider_user_id);

CREATE POLICY "Riders can update own offers" 
ON public.dispatch_offers 
FOR UPDATE 
USING (auth.uid() = rider_user_id);

CREATE POLICY "Vendors can view offers for their orders" 
ON public.dispatch_offers 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM dispatch_requests dr
  WHERE dr.id = dispatch_offers.dispatch_request_id
  AND owns_vendor(auth.uid(), dr.vendor_id)
));

CREATE POLICY "Admins can manage all offers" 
ON public.dispatch_offers 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Enable realtime for dispatch tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_offers;

-- Add dispatch configuration to platform_settings
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('dispatch_acceptance_timeout_seconds', '60', 'Time riders have to accept a dispatch offer'),
  ('dispatch_max_retries', '3', 'Maximum retry attempts before marking dispatch failed'),
  ('dispatch_retry_radius_expansion_km', '2', 'How much to expand search radius on retry'),
  ('dispatch_enable_priority_tiers', 'true', 'Enable tiered dispatch (vendor > company > platform)'),
  ('dispatch_priority_tier_timeout_seconds', '30', 'Time to wait per priority tier before expanding'),
  ('dispatch_initial_radius_km', '5', 'Initial search radius for riders')
ON CONFLICT (key) DO NOTHING;