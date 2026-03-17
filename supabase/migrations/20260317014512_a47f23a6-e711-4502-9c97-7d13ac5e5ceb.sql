
-- Add AI ad image generation price setting
INSERT INTO platform_settings (key, value) 
VALUES ('ai_ad_image_price', '500')
ON CONFLICT (key) DO NOTHING;
