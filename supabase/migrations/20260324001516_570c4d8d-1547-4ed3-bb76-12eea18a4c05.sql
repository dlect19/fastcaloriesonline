-- Delete the stuck redemption for dlect19@gmail.com
DELETE FROM free_meal_audit WHERE redemption_id = '5714cfb4-7e97-4d2b-a4c0-3514cd1c2dad';
DELETE FROM free_meal_redemptions WHERE id = '5714cfb4-7e97-4d2b-a4c0-3514cd1c2dad';

-- Update audit to cancelled for the cancelled free meal order
UPDATE free_meal_audit 
SET status = 'cancelled', 
    notes = 'Free meal restored — order was cancelled',
    updated_at = now()
WHERE user_id = '0b6ec265-bf3f-48d0-b52f-8f0202ef88ef' 
  AND promo_id = '2fe7a1a9-8736-4e0b-8e09-5a5647dac964'
  AND status = 'claimed';

-- Create a database function for restoring free meals on cancel
-- This runs with SECURITY DEFINER so RLS doesn't block it
CREATE OR REPLACE FUNCTION public.restore_free_meal_on_cancel(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_promo_id uuid;
  v_is_free_meal boolean;
  v_redemption_id uuid;
BEGIN
  SELECT user_id, is_free_meal, free_meal_promo_id
  INTO v_user_id, v_is_free_meal, v_promo_id
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND OR NOT v_is_free_meal OR v_promo_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id INTO v_redemption_id
  FROM free_meal_redemptions
  WHERE user_id = v_user_id AND promo_id = v_promo_id AND status = 'redeemed'
  LIMIT 1;

  IF v_redemption_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE free_meal_audit
  SET status = 'cancelled', notes = 'Free meal restored — order was cancelled', updated_at = now()
  WHERE redemption_id = v_redemption_id;

  UPDATE free_meal_audit SET redemption_id = NULL WHERE redemption_id = v_redemption_id;

  DELETE FROM free_meal_redemptions WHERE id = v_redemption_id;

  RETURN true;
END;
$$