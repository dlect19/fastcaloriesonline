
-- Add referral_code and referred_by to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id);

-- Create index for fast referral code lookups
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);

-- Referral tracking table
CREATE TABLE public.referrals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES public.profiles(id),
  referred_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'flagged')),
  trigger_order_id UUID REFERENCES public.orders(id),
  referrer_bonus NUMERIC NOT NULL DEFAULT 0,
  referred_bonus NUMERIC NOT NULL DEFAULT 0,
  referrer_credited BOOLEAN NOT NULL DEFAULT false,
  referred_credited BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE(referred_id)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Customers can see their own referrals (as referrer)
CREATE POLICY "Users can view referrals they made" ON public.referrals
  FOR SELECT USING (auth.uid() = referrer_id);

-- Users can see referrals where they are the referred
CREATE POLICY "Users can view their own referral" ON public.referrals
  FOR SELECT USING (auth.uid() = referred_id);

-- Admin full access
CREATE POLICY "Admin full access to referrals" ON public.referrals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
  );

-- Referral settings in platform_settings (seed defaults)
INSERT INTO public.platform_settings (key, value) VALUES
  ('referral_referrer_bonus', '300'),
  ('referral_new_user_bonus', '200'),
  ('referral_min_order_amount', '2000'),
  ('referral_bonus_expiry_days', '30'),
  ('referral_daily_limit', '10'),
  ('referral_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Add referral_bonus_balance and referral_bonus_expires_at to wallets
ALTER TABLE public.wallets
ADD COLUMN IF NOT EXISTS referral_bonus_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS test_referral_bonus_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS referral_bonus_expires_at TIMESTAMPTZ;

-- Enable realtime for referrals
ALTER PUBLICATION supabase_realtime ADD TABLE public.referrals;

-- Function to generate referral code on profile creation
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER AS $$
DECLARE
  v_name TEXT;
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  IF NEW.referral_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  v_name := LOWER(REGEXP_REPLACE(COALESCE(SPLIT_PART(NEW.full_name, ' ', 1), 'user'), '[^a-zA-Z]', '', 'g'));
  IF LENGTH(v_name) < 2 THEN v_name := 'fc'; END IF;
  v_name := LEFT(v_name, 6);
  
  LOOP
    v_code := 'FC-' || v_name || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    SELECT EXISTS(SELECT 1 FROM profiles WHERE referral_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  NEW.referral_code := v_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_referral_code();

-- Backfill existing profiles with referral codes
DO $$
DECLARE
  r RECORD;
  v_name TEXT;
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  FOR r IN SELECT id, full_name FROM profiles WHERE referral_code IS NULL LOOP
    v_name := LOWER(REGEXP_REPLACE(COALESCE(SPLIT_PART(r.full_name, ' ', 1), 'user'), '[^a-zA-Z]', '', 'g'));
    IF LENGTH(v_name) < 2 THEN v_name := 'fc'; END IF;
    v_name := LEFT(v_name, 6);
    LOOP
      v_code := 'FC-' || v_name || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
      SELECT EXISTS(SELECT 1 FROM profiles WHERE referral_code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
    UPDATE profiles SET referral_code = v_code WHERE id = r.id;
  END LOOP;
END $$;
