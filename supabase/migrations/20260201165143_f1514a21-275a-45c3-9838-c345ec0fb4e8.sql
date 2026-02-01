-- Fix health goal constraint to allow all 6 values (app + legacy)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_health_goal_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_health_goal_check 
  CHECK (health_goal IS NULL OR health_goal = ANY (ARRAY[
    'maintain', 'light_eating', 'active_lifestyle',
    'lose_weight', 'gain_weight', 'build_muscle'
  ]));

-- Add restriction_mode column to vendor_riders for future flexibility
ALTER TABLE public.vendor_riders 
  ADD COLUMN IF NOT EXISTS restriction_mode TEXT 
  DEFAULT 'vendor_only' 
  CHECK (restriction_mode IN ('vendor_only', 'any_orders'));