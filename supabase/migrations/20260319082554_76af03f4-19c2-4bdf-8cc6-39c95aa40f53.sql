
DELETE FROM free_meal_redemptions WHERE user_id = '0b6ec265-bf3f-48d0-b52f-8f0202ef88ef' AND promo_id = '2fe7a1a9-8736-4e0b-8e09-5a5647dac964';

UPDATE free_meal_progress SET is_eligible = false, highest_order_amount = 0, period_start = now() WHERE user_id = '0b6ec265-bf3f-48d0-b52f-8f0202ef88ef' AND promo_id = '2fe7a1a9-8736-4e0b-8e09-5a5647dac964';
