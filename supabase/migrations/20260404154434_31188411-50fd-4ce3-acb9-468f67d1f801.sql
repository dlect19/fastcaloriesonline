
-- Ambassador system tables

-- Ambassadors table
CREATE TABLE public.ambassadors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  social_handle TEXT,
  promo_code TEXT NOT NULL UNIQUE,
  package_type TEXT NOT NULL DEFAULT 'paid' CHECK (package_type IN ('paid', 'equity')),
  current_level INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ambassador tiers/levels
CREATE TABLE public.ambassador_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  level INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  min_registrations INTEGER NOT NULL DEFAULT 0,
  min_orders INTEGER NOT NULL DEFAULT 0,
  min_revenue NUMERIC NOT NULL DEFAULT 0,
  reward_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ambassador performance tracking
CREATE TABLE public.ambassador_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  total_registrations INTEGER NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ambassador level history
CREATE TABLE public.ambassador_level_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  upgraded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ambassador campaigns (for paid promotions)
CREATE TABLE public.ambassador_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  payment_amount NUMERIC NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  deliverables TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default tiers
INSERT INTO public.ambassador_tiers (level, name, min_registrations, min_orders, min_revenue, reward_description) VALUES
  (1, 'Bronze', 0, 0, 0, 'Welcome tier - basic perks'),
  (2, 'Silver', 25, 50, 100000, '5% commission on referred orders'),
  (3, 'Gold', 75, 200, 500000, '7.5% commission + monthly bonus'),
  (4, 'Platinum', 200, 500, 1500000, '10% commission + quarterly bonus'),
  (5, 'Diamond', 500, 1000, 5000000, '15% commission + equity consideration');

-- RLS
ALTER TABLE public.ambassadors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_level_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_campaigns ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (using admin_staff check)
CREATE POLICY "Admin can manage ambassadors" ON public.ambassadors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can manage ambassador_tiers" ON public.ambassador_tiers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can manage ambassador_performance" ON public.ambassador_performance FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can manage ambassador_level_history" ON public.ambassador_level_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can manage ambassador_campaigns" ON public.ambassador_campaigns FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true));
