-- Drop the overly permissive policy and keep only the specific one
DROP POLICY IF EXISTS "System can insert stats" ON user_order_stats;