
-- ============================================================
-- ADVERTISEMENT SYSTEM: Wallets, Placements, Impressions, Pricing
-- ============================================================

-- 1. Ad pricing packages (admin-managed CPM pricing)
CREATE TABLE public.ad_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                          -- e.g. "Carousel Banner", "Announcement Screen"
  placement_type TEXT NOT NULL DEFAULT 'carousel', -- carousel, announcement, popup
  cpm_rate NUMERIC NOT NULL DEFAULT 500,       -- cost per 1000 impressions in Naira
  min_budget NUMERIC NOT NULL DEFAULT 5000,    -- minimum spend
  min_duration_days INTEGER NOT NULL DEFAULT 1,
  max_duration_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage ad pricing" ON public.ad_pricing FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can view active ad pricing" ON public.ad_pricing FOR SELECT
  USING (is_active = true);

-- 2. Ad wallets for vendors (separate from earnings wallet)
CREATE TABLE public.ad_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  total_funded NUMERIC NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(vendor_id)
);
ALTER TABLE public.ad_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors can view own ad wallet" ON public.ad_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins can manage all ad wallets" ON public.ad_wallets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Ad wallet transactions (audit ledger)
CREATE TABLE public.ad_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_wallet_id UUID NOT NULL REFERENCES public.ad_wallets(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('credit', 'debit')),
  category TEXT NOT NULL, -- 'funding_from_earnings', 'funding_direct_payment', 'admin_credit', 'ad_spend', 'refund'
  amount NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL DEFAULT 0,
  reference TEXT,           -- paystack ref or internal ref
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors can view own ad wallet txns" ON public.ad_wallet_transactions FOR SELECT TO authenticated
  USING (vendor_id IN (SELECT id FROM vendors WHERE user_id = auth.uid()));
CREATE POLICY "Admins can manage all ad wallet txns" ON public.ad_wallet_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. Vendor ad placements (vendor-submitted ads awaiting approval)
CREATE TABLE public.ad_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  advertisement_id UUID REFERENCES public.advertisements(id) ON DELETE SET NULL,
  
  -- Content
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url TEXT,
  
  -- Targeting
  placement_type TEXT NOT NULL DEFAULT 'carousel', -- carousel, announcement
  target_latitude NUMERIC,   -- vendor outlet location
  target_longitude NUMERIC,
  target_radius_km NUMERIC DEFAULT 10,  -- show within this radius
  
  -- Scheduling
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  
  -- Pricing
  ad_pricing_id UUID REFERENCES public.ad_pricing(id),
  budget NUMERIC NOT NULL DEFAULT 0,        -- total budget allocated
  spent NUMERIC NOT NULL DEFAULT 0,         -- amount spent so far
  cpm_rate NUMERIC NOT NULL DEFAULT 500,    -- locked-in CPM at time of purchase
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending_review', -- pending_review, approved, active, paused, completed, rejected
  rejection_reason TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  
  -- Tracking
  total_impressions INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors can manage own ad placements" ON public.ad_placements FOR ALL TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins can manage all ad placements" ON public.ad_placements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. Ad impressions tracking (granular view/click logging)
CREATE TABLE public.ad_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_placement_id UUID REFERENCES public.ad_placements(id) ON DELETE CASCADE,
  advertisement_id UUID REFERENCES public.advertisements(id) ON DELETE CASCADE,
  viewer_user_id UUID,      -- nullable for anonymous
  event_type TEXT NOT NULL DEFAULT 'view', -- view, click
  viewer_latitude NUMERIC,
  viewer_longitude NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;
-- Impressions are insert-only from edge function, readable by ad owner and admins
CREATE POLICY "Insert impressions via service" ON public.ad_impressions FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Vendors can view own ad impressions" ON public.ad_impressions FOR SELECT TO authenticated
  USING (
    ad_placement_id IN (SELECT id FROM ad_placements WHERE user_id = auth.uid())
    OR advertisement_id IN (SELECT a.id FROM advertisements a JOIN ad_placements ap ON ap.advertisement_id = a.id WHERE ap.user_id = auth.uid())
  );
CREATE POLICY "Admins can view all impressions" ON public.ad_impressions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Index for fast impression counting
CREATE INDEX idx_ad_impressions_placement ON public.ad_impressions(ad_placement_id, event_type);
CREATE INDEX idx_ad_impressions_ad ON public.ad_impressions(advertisement_id, event_type);
CREATE INDEX idx_ad_impressions_created ON public.ad_impressions(created_at);

-- 6. Add location targeting columns to existing advertisements table
ALTER TABLE public.advertisements 
  ADD COLUMN IF NOT EXISTS target_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS target_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS target_radius_km NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ad_placement_id UUID REFERENCES public.ad_placements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_impressions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_clicks INTEGER NOT NULL DEFAULT 0;

-- 7. Seed default ad pricing
INSERT INTO public.ad_pricing (name, placement_type, cpm_rate, min_budget, min_duration_days, max_duration_days)
VALUES 
  ('Carousel Banner', 'carousel', 500, 5000, 1, 30),
  ('Announcement Screen', 'announcement', 300, 3000, 1, 14);

-- 8. Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_placements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_wallets;
