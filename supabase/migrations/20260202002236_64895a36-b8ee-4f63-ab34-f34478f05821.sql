-- First, clear the foreign key references in spin_results
UPDATE spin_results SET segment_id = NULL;

-- Now delete existing segments and configs
DELETE FROM spin_wheel_segments;
DELETE FROM spin_wheel_config;

-- Insert wheel configurations
INSERT INTO spin_wheel_config (wheel_type, cost, is_active) VALUES
  ('free', 0, true),
  ('tier1', 100, true),
  ('tier2', 200, true),
  ('tier3', 500, true);

-- FREE WHEEL: Try Again, 0%, 10%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, 'Try Again', 0, true, 40, '#FF6B6B', 0 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, '0%', 0, false, 35, '#4ECDC4', 1 FROM spin_wheel_config WHERE wheel_type = 'free'
UNION ALL
SELECT id, '10% OFF', 10, false, 25, '#45B7D1', 2 FROM spin_wheel_config WHERE wheel_type = 'free';

-- BRONZE WHEEL (₦100): Try Again, 0%, 10%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, 'Try Again', 0, true, 30, '#FF6B6B', 0 FROM spin_wheel_config WHERE wheel_type = 'tier1'
UNION ALL
SELECT id, '0%', 0, false, 35, '#FFD93D', 1 FROM spin_wheel_config WHERE wheel_type = 'tier1'
UNION ALL
SELECT id, '10% OFF', 10, false, 35, '#6BCB77', 2 FROM spin_wheel_config WHERE wheel_type = 'tier1';

-- SILVER WHEEL (₦200): Try Again, 0%, 20%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, 'Try Again', 0, true, 25, '#FF6B6B', 0 FROM spin_wheel_config WHERE wheel_type = 'tier2'
UNION ALL
SELECT id, '0%', 0, false, 35, '#C0C0C0', 1 FROM spin_wheel_config WHERE wheel_type = 'tier2'
UNION ALL
SELECT id, '20% OFF', 20, false, 40, '#9B59B6', 2 FROM spin_wheel_config WHERE wheel_type = 'tier2';

-- GOLD WHEEL (₦500): Try Again, 0%, 20%, 30%
INSERT INTO spin_wheel_segments (wheel_config_id, segment_label, discount_percentage, is_try_again, probability_weight, color, sort_order)
SELECT id, 'Try Again', 0, true, 15, '#FF6B6B', 0 FROM spin_wheel_config WHERE wheel_type = 'tier3'
UNION ALL
SELECT id, '0%', 0, false, 25, '#FFD700', 1 FROM spin_wheel_config WHERE wheel_type = 'tier3'
UNION ALL
SELECT id, '20% OFF', 20, false, 35, '#F39C12', 2 FROM spin_wheel_config WHERE wheel_type = 'tier3'
UNION ALL
SELECT id, '30% OFF', 30, false, 25, '#E74C3C', 3 FROM spin_wheel_config WHERE wheel_type = 'tier3';