-- Fix: Add insert policy for user_order_stats (system needs to insert on first order)
-- The trigger runs as SECURITY DEFINER so it bypasses RLS, but let's add proper policies anyway
CREATE POLICY "System can insert stats" ON user_order_stats FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert own stats" ON user_order_stats FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Add policy for promo_usage_log inserts from edge functions
CREATE POLICY "Users can insert own promo usage" ON promo_usage_log FOR INSERT WITH CHECK (auth.uid() = user_id);