-- Add daily winner limit column to spin_wheel_segments
-- NULL means unlimited winners for that segment
ALTER TABLE spin_wheel_segments 
ADD COLUMN IF NOT EXISTS daily_winner_limit integer DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN spin_wheel_segments.daily_winner_limit IS 'Maximum number of users who can win this segment per day. NULL = unlimited.';

-- Set some default limits for high-value segments (can be adjusted by admin)
-- 30% OFF: limit to 5 winners per day
UPDATE spin_wheel_segments SET daily_winner_limit = 5 WHERE discount_percentage = 30;

-- 20% OFF: limit to 20 winners per day
UPDATE spin_wheel_segments SET daily_winner_limit = 20 WHERE discount_percentage = 20;

-- 10% OFF: limit to 50 winners per day  
UPDATE spin_wheel_segments SET daily_winner_limit = 50 WHERE discount_percentage = 10;

-- Try Again and 0%: unlimited (NULL)