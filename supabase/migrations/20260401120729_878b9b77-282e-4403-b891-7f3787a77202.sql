ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS age integer,
ADD COLUMN IF NOT EXISTS gender text,
ADD COLUMN IF NOT EXISTS height_cm numeric,
ADD COLUMN IF NOT EXISTS weight_kg numeric,
ADD COLUMN IF NOT EXISTS activity_level text,
ADD COLUMN IF NOT EXISTS weekly_goal_kg numeric,
ADD COLUMN IF NOT EXISTS daily_protein_target_grams integer,
ADD COLUMN IF NOT EXISTS daily_carbs_target_grams integer,
ADD COLUMN IF NOT EXISTS daily_fat_target_grams integer;