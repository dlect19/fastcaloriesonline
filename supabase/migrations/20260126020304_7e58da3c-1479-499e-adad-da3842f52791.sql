-- Add vendor-specific fields to promo_codes
ALTER TABLE public.promo_codes 
ADD COLUMN vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
ADD COLUMN per_user_limit integer DEFAULT NULL,
ADD COLUMN scope text DEFAULT 'platform' CHECK (scope IN ('platform', 'vendor'));

-- Create table to track per-user promo usage
CREATE TABLE public.promo_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id uuid REFERENCES public.promo_codes(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  used_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(promo_id, user_id)
);

-- Enable RLS on promo_usage
ALTER TABLE public.promo_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies for promo_usage
CREATE POLICY "Users can view own promo usage" ON public.promo_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own promo usage" ON public.promo_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own promo usage" ON public.promo_usage
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow vendors to manage their own promos
CREATE POLICY "Vendors can manage own promos" ON public.promo_codes
  FOR ALL USING (vendor_id IS NOT NULL AND owns_vendor(auth.uid(), vendor_id));

-- Add delivery preferences to vendors
ALTER TABLE public.vendors
ADD COLUMN delivery_mode text DEFAULT 'platform' CHECK (delivery_mode IN ('own', 'platform', 'both')),
ADD COLUMN own_rider_priority boolean DEFAULT true;

-- Create vendor_riders table
CREATE TABLE public.vendor_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE NOT NULL,
  rider_profile_id uuid REFERENCES public.rider_profiles(id) ON DELETE CASCADE NOT NULL,
  invite_code text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vendor_id, rider_profile_id)
);

-- Add vendor affiliation to rider_profiles
ALTER TABLE public.rider_profiles
ADD COLUMN affiliated_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

-- Enable RLS on vendor_riders
ALTER TABLE public.vendor_riders ENABLE ROW LEVEL SECURITY;

-- RLS policies for vendor_riders
CREATE POLICY "Vendors can manage own riders" ON public.vendor_riders
  FOR ALL USING (owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Riders can view their affiliations" ON public.vendor_riders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rider_profiles 
      WHERE id = vendor_riders.rider_profile_id 
      AND user_id = auth.uid()
    )
  );

-- Create vendor invite codes table for rider invitations
CREATE TABLE public.vendor_rider_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE NOT NULL,
  invite_code text UNIQUE NOT NULL,
  is_used boolean DEFAULT false,
  used_by uuid REFERENCES public.rider_profiles(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on vendor_rider_invites
ALTER TABLE public.vendor_rider_invites ENABLE ROW LEVEL SECURITY;

-- RLS policies for vendor_rider_invites
CREATE POLICY "Vendors can manage own invites" ON public.vendor_rider_invites
  FOR ALL USING (owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Anyone can view invites by code" ON public.vendor_rider_invites
  FOR SELECT USING (true);