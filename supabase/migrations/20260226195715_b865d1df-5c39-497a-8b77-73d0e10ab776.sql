
-- One-time fix: correct the over-credited wallet balance
-- 5 duplicate ₦2,700 credits were removed, need to subtract ₦13,500
DO $$
BEGIN
  PERFORM set_config('app.bypass_balance_trigger', 'true', true);
  UPDATE wallets SET balance = balance - 13500, updated_at = NOW()
  WHERE id = '0c76b424-1e7b-4ad7-8714-f10314007a36';
  PERFORM set_config('app.bypass_balance_trigger', 'false', true);
END;
$$;
