
-- Add subscription type column to push_subscriptions table
ALTER TABLE public.push_subscriptions 
ADD COLUMN IF NOT EXISTS subscription_type TEXT NOT NULL DEFAULT 'web_push';

-- Add fcm_token column for FCM subscriptions
ALTER TABLE public.push_subscriptions 
ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Update unique constraint to handle both types
-- Drop existing constraint if any and recreate
ALTER TABLE public.push_subscriptions 
DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

-- Create new unique constraint that works for both types
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_id_endpoint_type_idx 
ON public.push_subscriptions (user_id, endpoint, subscription_type);

-- Add index for faster lookups by type
CREATE INDEX IF NOT EXISTS push_subscriptions_type_idx 
ON public.push_subscriptions (subscription_type);
