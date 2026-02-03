-- Add platform settings for unified spin wheel algorithm control
-- Segment discounts (comma-separated)
INSERT INTO platform_settings (key, value, description)
VALUES ('spin_segment_discounts', '0,2,5,8,10', 'Comma-separated discount percentages for spin segments')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Segment weights (comma-separated, must match discounts count + 1 for Try Again)
INSERT INTO platform_settings (key, value, description)
VALUES ('spin_segment_weights', '25,25,20,15,10,5', 'Comma-separated probability weights for each segment (last is Try Again)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Segment colors (comma-separated)
INSERT INTO platform_settings (key, value, description)
VALUES ('spin_segment_colors', '#6B7280,#10B981,#3B82F6,#8B5CF6,#F59E0B,#EF4444', 'Comma-separated hex colors for each segment')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Spins per tier
INSERT INTO platform_settings (key, value, description)
VALUES ('spin_tier1_spins', '1', 'Number of spins for Bronze tier (₦100)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO platform_settings (key, value, description)
VALUES ('spin_tier2_spins', '3', 'Number of spins for Silver tier (₦200)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO platform_settings (key, value, description)
VALUES ('spin_tier3_spins', '6', 'Number of spins for Gold tier (₦500)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Max discount cap (already exists but ensure it's there)
INSERT INTO platform_settings (key, value, description)
VALUES ('spin_max_discount_percent', '10', 'Maximum discount percentage allowed from spin wheel')
ON CONFLICT (key) DO UPDATE SET updated_at = now();