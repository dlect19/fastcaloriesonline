-- Add nutrient_tags column to products table for descriptive badges
ALTER TABLE public.products 
ADD COLUMN nutrient_tags text[] DEFAULT '{}';

-- Add a comment explaining the valid values
COMMENT ON COLUMN public.products.nutrient_tags IS 'Descriptive nutrient tags: water-rich, vitamin-rich, mineral-rich';