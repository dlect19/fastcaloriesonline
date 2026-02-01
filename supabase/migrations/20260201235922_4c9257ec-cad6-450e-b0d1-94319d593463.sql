-- ============================================
-- PROMOTIONS & SPIN WHEEL SYSTEM
-- ============================================

-- 1. Platform Promotions Configuration Table
CREATE TABLE public.platform_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_type TEXT NOT NULL CHECK (promo_type IN ('first_order', 'loyalty_10th', 'spin_free', 'spin_paid_tier1', 'spin_paid_tier2', 'spin_paid_tier3')),
  name TEXT NOT NULL,
  description TEXT,
  discount_percentage NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Spin Wheel Configuration Table
CREATE TABLE public.spin_wheel_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wheel_type TEXT NOT NULL CHECK (wheel_type IN ('free', 'tier1', 'tier2', 'tier3')),
  cost NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(wheel_type)
);

-- 3. Spin Wheel Segments (rewards for each wheel)
CREATE TABLE public.spin_wheel_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wheel_config_id UUID NOT NULL REFERENCES spin_wheel_config(id) ON DELETE CASCADE,
  segment_label TEXT NOT NULL,
  discount_percentage NUMERIC NOT NULL DEFAULT 0,
  is_try_again BOOLEAN DEFAULT false,
  probability_weight NUMERIC NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#4CAF50',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. User Spin History & Rewards
CREATE TABLE public.spin_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wheel_type TEXT NOT NULL,
  segment_id UUID REFERENCES spin_wheel_segments(id),
  discount_percentage NUMERIC NOT NULL DEFAULT 0,
  is_try_again BOOLEAN DEFAULT false,
  is_used BOOLEAN DEFAULT false,
  used_on_order_id UUID REFERENCES orders(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Daily Free Spin Tracking
CREATE TABLE public.daily_spin_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  spin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  free_spins_used INTEGER DEFAULT 0,
  try_again_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, spin_date)
);

-- 6. Promo Algorithm Controls (Admin Settings)
-- Add to platform_settings for flexibility
INSERT INTO platform_settings (key, value, description) VALUES
  ('promo_daily_revenue_cap_percent', '8', 'Maximum % of daily revenue that can be given as promo discounts'),
  ('promo_daily_winner_limit', '200', 'Maximum number of users who can win 30%+ discounts per day'),
  ('promo_first_order_enabled', 'true', 'Enable first order 5% discount'),
  ('promo_first_order_percent', '5', 'First order discount percentage'),
  ('promo_loyalty_enabled', 'true', 'Enable 10th order loyalty discount'),
  ('promo_loyalty_percent', '10', 'Loyalty discount percentage'),
  ('spin_discount_expiry_hours', '24', 'Hours until spin discount expires'),
  ('spin_free_enabled', 'true', 'Enable free daily spin wheel'),
  ('spin_paid_enabled', 'true', 'Enable paid spin wheels')
ON CONFLICT (key) DO NOTHING;

-- 7. User Completed Orders Count (for loyalty tracking)
CREATE TABLE public.user_order_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  completed_orders INTEGER DEFAULT 0,
  total_spent NUMERIC DEFAULT 0,
  first_order_promo_used BOOLEAN DEFAULT false,
  last_loyalty_promo_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Promo Usage Log (for accounting & analytics)
CREATE TABLE public.promo_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  order_id UUID REFERENCES orders(id),
  promo_type TEXT NOT NULL,
  promo_source TEXT NOT NULL CHECK (promo_source IN ('platform', 'spin_wheel', 'promo_code')),
  discount_percentage NUMERIC NOT NULL,
  discount_amount NUMERIC NOT NULL,
  platform_cost NUMERIC NOT NULL,
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Daily Promo Stats (for algorithm control)
CREATE TABLE public.daily_promo_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_promo_cost NUMERIC DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  high_discount_winners INTEGER DEFAULT 0,
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stat_date, environment)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_spin_results_user_id ON spin_results(user_id);
CREATE INDEX idx_spin_results_expires_at ON spin_results(expires_at);
CREATE INDEX idx_spin_results_unused ON spin_results(user_id, is_used) WHERE is_used = false;
CREATE INDEX idx_daily_spin_usage_user_date ON daily_spin_usage(user_id, spin_date);
CREATE INDEX idx_promo_usage_log_order ON promo_usage_log(order_id);
CREATE INDEX idx_promo_usage_log_date ON promo_usage_log(created_at);
CREATE INDEX idx_user_order_stats_user ON user_order_stats(user_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE platform_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spin_wheel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE spin_wheel_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE spin_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_spin_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_order_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_promo_stats ENABLE ROW LEVEL SECURITY;

-- Platform Promotions: Anyone can view, admins can manage
CREATE POLICY "Anyone can view active promotions" ON platform_promotions FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage promotions" ON platform_promotions FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Spin Wheel Config: Anyone can view active, admins manage
CREATE POLICY "Anyone can view active wheels" ON spin_wheel_config FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage spin config" ON spin_wheel_config FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Spin Wheel Segments: Anyone can view
CREATE POLICY "Anyone can view segments" ON spin_wheel_segments FOR SELECT USING (true);
CREATE POLICY "Admins can manage segments" ON spin_wheel_segments FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Spin Results: Users can view own, admins can view all
CREATE POLICY "Users can view own spin results" ON spin_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own spin results" ON spin_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own spin results" ON spin_results FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all spin results" ON spin_results FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- Daily Spin Usage: Users can manage own
CREATE POLICY "Users can manage own daily spin" ON daily_spin_usage FOR ALL USING (auth.uid() = user_id);

-- User Order Stats: Users can view own, system updates
CREATE POLICY "Users can view own stats" ON user_order_stats FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can manage stats" ON user_order_stats FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Promo Usage Log: Users can view own, admins can view all
CREATE POLICY "Users can view own promo usage" ON promo_usage_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage promo logs" ON promo_usage_log FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Daily Promo Stats: Admins only
CREATE POLICY "Admins can manage daily stats" ON daily_promo_stats FOR ALL USING (has_role(auth.uid(), 'admin'));

-- ============================================
-- SEED DEFAULT SPIN WHEEL CONFIGURATION
-- ============================================
INSERT INTO spin_wheel_config (wheel_type, cost, is_active) VALUES
  ('free', 0, true),
  ('tier1', 100, true),
  ('tier2', 200, true),
  ('tier3', 500, true);

-- Free Wheel Segments
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, '0%', 0, false, 25, '#9E9E9E', 1 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, '5%', 5, false, 30, '#4CAF50', 2 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, '10%', 10, false, 20, '#2196F3', 3 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, '15%', 15, false, 10, '#FF9800', 4 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, 'Try Again', 0, true, 15, '#F44336', 5 FROM spin_wheel_config WHERE wheel_type = 'free';

-- Tier 1 (₦100): 0-15%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, '0%', 0, false, 20, '#9E9E9E', 1 FROM spin_wheel_config WHERE wheel_type = 'tier1'
UNION ALL
SELECT id, '5%', 5, false, 30, '#4CAF50', 2 FROM spin_wheel_config WHERE wheel_type = 'tier1'
UNION ALL
SELECT id, '10%', 10, false, 30, '#2196F3', 3 FROM spin_wheel_config WHERE wheel_type = 'tier1'
UNION ALL
SELECT id, '15%', 15, false, 20, '#FF9800', 4 FROM spin_wheel_config WHERE wheel_type = 'tier1';

-- Tier 2 (₦200): 20-30%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, '20%', 20, false, 40, '#4CAF50', 1 FROM spin_wheel_config WHERE wheel_type = 'tier2'
UNION ALL
SELECT id, '25%', 25, false, 35, '#2196F3', 2 FROM spin_wheel_config WHERE wheel_type = 'tier2'
UNION ALL
SELECT id, '30%', 30, false, 25, '#FF9800', 3 FROM spin_wheel_config WHERE wheel_type = 'tier2';

-- Tier 3 (₦500): 40-50%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, '40%', 40, false, 45, '#4CAF50', 1 FROM spin_wheel_config WHERE wheel_type = 'tier3'
UNION ALL
SELECT id, '45%', 45, false, 35, '#2196F3', 2 FROM spin_wheel_config WHERE wheel_type = 'tier3'
UNION ALL
SELECT id, '50%', 50, false, 20, '#FF9800', 3 FROM spin_wheel_config WHERE wheel_type = 'tier3';

-- ============================================
-- FUNCTION: Update user order stats on order completion
-- ============================================
CREATE OR REPLACE FUNCTION public.update_user_order_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only run when status changes to 'delivered'
  IF NEW.status = 'delivered' AND (OLD.status IS NULL OR OLD.status != 'delivered') THEN
    INSERT INTO user_order_stats (user_id, completed_orders, total_spent)
    VALUES (NEW.user_id, 1, NEW.subtotal)
    ON CONFLICT (user_id) DO UPDATE SET
      completed_orders = user_order_stats.completed_orders + 1,
      total_spent = user_order_stats.total_spent + NEW.subtotal,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for order stats
CREATE TRIGGER on_order_delivered_update_stats
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_user_order_stats();