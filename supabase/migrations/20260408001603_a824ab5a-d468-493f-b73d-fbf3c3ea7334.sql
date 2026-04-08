ALTER TABLE public.calorie_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'order';
ALTER TABLE public.calorie_logs ADD COLUMN food_items TEXT[] DEFAULT NULL;
ALTER TABLE public.calorie_logs ADD COLUMN image_url TEXT DEFAULT NULL;
ALTER TABLE public.calorie_logs ADD COLUMN confidence TEXT DEFAULT NULL;
ALTER TABLE public.calorie_logs ADD COLUMN fiber_grams NUMERIC DEFAULT NULL;
ALTER TABLE public.calorie_logs ADD COLUMN food_classes TEXT[] DEFAULT NULL;
ALTER TABLE public.calorie_logs ADD COLUMN nutrient_tags TEXT[] DEFAULT NULL;