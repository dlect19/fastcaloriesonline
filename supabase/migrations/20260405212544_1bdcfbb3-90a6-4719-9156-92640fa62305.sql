
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS serving_size_grams numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nutrition_source text DEFAULT 'vendor' CHECK (nutrition_source IN ('vendor', 'ai_estimated', 'database', 'calculated'));

COMMENT ON COLUMN public.products.serving_size_grams IS 'Weight in grams per serving unit for accurate calorie tracking';
COMMENT ON COLUMN public.products.nutrition_source IS 'How nutrition data was obtained: vendor (manual), ai_estimated, database, or calculated';
