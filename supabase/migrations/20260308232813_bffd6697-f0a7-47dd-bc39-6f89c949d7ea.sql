
CREATE OR REPLACE FUNCTION public.full_reconcile_wallets(p_environment TEXT DEFAULT 'production', p_dry_run BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet RECORD;
  v_corrections JSONB := '[]'::JSONB;
  v_menu_credits NUMERIC; v_menu_debits NUMERIC; v_menu_pending NUMERIC;
  v_rider_credits NUMERIC; v_rider_debits NUMERIC;
  v_menu_withdrawals NUMERIC; v_rider_withdrawals NUMERIC; v_withdrawal_reversals NUMERIC;
  v_admin_debits NUMERIC; v_admin_credits NUMERIC; v_dispute_debits NUMERIC;
  v_generic_credits NUMERIC; v_generic_debits NUMERIC; v_generic_withdrawn NUMERIC; v_generic_reversals NUMERIC;
  v_expected_balance NUMERIC; v_expected_eligible NUMERIC; v_expected_menu NUMERIC;
  v_expected_rider NUMERIC; v_expected_earned NUMERIC; v_expected_withdrawn NUMERIC;
  v_db_balance NUMERIC; v_db_eligible NUMERIC; v_db_menu NUMERIC; v_db_rider NUMERIC;
  v_db_earned NUMERIC; v_db_withdrawn NUMERIC;
  v_correction JSONB;
BEGIN
  FOR v_wallet IN SELECT * FROM wallets LOOP
    IF v_wallet.wallet_type = 'vendor' THEN
      SELECT
        COALESCE(SUM(CASE WHEN category='vendor_share' AND status='completed' AND transaction_type='credit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='vendor_share' AND status='completed' AND transaction_type='debit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='vendor_share' AND status='pending' AND transaction_type='credit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='vendor_rider_share' AND status='completed' AND transaction_type='credit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='vendor_rider_share' AND status='completed' AND transaction_type='debit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='withdrawal' AND transaction_type='debit' AND (notes IS NULL OR notes NOT LIKE '%Rider Revenue%') THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='withdrawal' AND transaction_type='debit' AND notes LIKE '%Rider Revenue%' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='withdrawal_reversal' AND transaction_type='credit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='admin_debit' AND transaction_type='debit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='admin_credit' AND transaction_type='credit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='dispute_deduction' AND transaction_type='debit' THEN amount END),0)
      INTO v_menu_credits, v_menu_debits, v_menu_pending, v_rider_credits, v_rider_debits,
           v_menu_withdrawals, v_rider_withdrawals, v_withdrawal_reversals, v_admin_debits, v_admin_credits, v_dispute_debits
      FROM wallet_transactions WHERE wallet_id = v_wallet.id AND environment = p_environment;

      v_expected_menu := ROUND(v_menu_credits - v_menu_debits - v_menu_withdrawals + v_withdrawal_reversals - v_admin_debits + v_admin_credits - v_dispute_debits, 2);
      v_expected_rider := ROUND(v_rider_credits - v_rider_debits - v_rider_withdrawals, 2);
      v_expected_balance := ROUND(v_expected_menu + v_expected_rider + v_menu_pending, 2);
      v_expected_eligible := ROUND(v_expected_balance - v_menu_pending, 2);
      v_expected_earned := ROUND(v_menu_credits - v_menu_debits + v_rider_credits - v_rider_debits, 2);
      v_expected_withdrawn := ROUND(v_menu_withdrawals + v_rider_withdrawals - v_withdrawal_reversals, 2);

      IF p_environment = 'development' THEN
        v_db_balance := COALESCE(v_wallet.test_balance,0); v_db_eligible := COALESCE(v_wallet.test_eligible_balance,0);
        v_db_menu := COALESCE(v_wallet.test_menu_earnings_balance,0); v_db_rider := COALESCE(v_wallet.test_rider_revenue_balance,0);
      ELSE
        v_db_balance := COALESCE(v_wallet.balance,0); v_db_eligible := COALESCE(v_wallet.eligible_balance,0);
        v_db_menu := COALESCE(v_wallet.menu_earnings_balance,0); v_db_rider := COALESCE(v_wallet.rider_revenue_balance,0);
      END IF;
      v_db_earned := COALESCE(v_wallet.total_earned,0); v_db_withdrawn := COALESCE(v_wallet.total_withdrawn,0);

      IF ROUND(v_db_balance,2) != v_expected_balance OR ROUND(v_db_eligible,2) != v_expected_eligible OR ROUND(v_db_menu,2) != v_expected_menu OR ROUND(v_db_rider,2) != v_expected_rider OR ROUND(v_db_earned,2) != v_expected_earned OR ROUND(v_db_withdrawn,2) != v_expected_withdrawn THEN
        v_correction := jsonb_build_object('wallet_id', v_wallet.id, 'type', v_wallet.wallet_type, 'outlet', v_wallet.outlet_id,
          'before', jsonb_build_object('bal', v_db_balance, 'elig', v_db_eligible, 'menu', v_db_menu, 'rider', v_db_rider, 'earned', v_db_earned, 'wdrawn', v_db_withdrawn),
          'after', jsonb_build_object('bal', v_expected_balance, 'elig', v_expected_eligible, 'menu', v_expected_menu, 'rider', v_expected_rider, 'earned', v_expected_earned, 'wdrawn', v_expected_withdrawn));
        v_corrections := v_corrections || v_correction;
        IF NOT p_dry_run THEN
          ALTER TABLE wallets DISABLE TRIGGER prevent_balance_manipulation;
          IF p_environment = 'development' THEN
            UPDATE wallets SET test_balance=v_expected_balance, test_eligible_balance=v_expected_eligible, test_pending_balance=v_menu_pending, test_menu_earnings_balance=v_expected_menu, test_menu_earnings_pending=v_menu_pending, test_rider_revenue_balance=v_expected_rider, total_earned=v_expected_earned, total_withdrawn=v_expected_withdrawn, updated_at=NOW() WHERE id=v_wallet.id;
          ELSE
            UPDATE wallets SET balance=v_expected_balance, eligible_balance=v_expected_eligible, pending_balance=v_menu_pending, menu_earnings_balance=v_expected_menu, menu_earnings_pending=v_menu_pending, rider_revenue_balance=v_expected_rider, total_earned=v_expected_earned, total_withdrawn=v_expected_withdrawn, updated_at=NOW() WHERE id=v_wallet.id;
          END IF;
          ALTER TABLE wallets ENABLE TRIGGER prevent_balance_manipulation;
        END IF;
      END IF;
    ELSE
      SELECT COALESCE(SUM(CASE WHEN transaction_type='credit' AND status='completed' THEN amount END),0),
        COALESCE(SUM(CASE WHEN transaction_type='debit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='withdrawal' AND transaction_type='debit' THEN amount END),0),
        COALESCE(SUM(CASE WHEN category='withdrawal_reversal' AND transaction_type='credit' THEN amount END),0)
      INTO v_generic_credits, v_generic_debits, v_generic_withdrawn, v_generic_reversals
      FROM wallet_transactions WHERE wallet_id=v_wallet.id AND environment=p_environment;

      v_expected_balance := ROUND(v_generic_credits - v_generic_debits, 2);
      v_expected_eligible := v_expected_balance;
      v_expected_earned := ROUND(v_generic_credits, 2);
      v_expected_withdrawn := ROUND(v_generic_withdrawn - v_generic_reversals, 2);

      IF p_environment = 'development' THEN
        v_db_balance := COALESCE(v_wallet.test_balance,0); v_db_eligible := COALESCE(v_wallet.test_eligible_balance,0);
      ELSE
        v_db_balance := COALESCE(v_wallet.balance,0); v_db_eligible := COALESCE(v_wallet.eligible_balance,0);
      END IF;
      v_db_earned := COALESCE(v_wallet.total_earned,0); v_db_withdrawn := COALESCE(v_wallet.total_withdrawn,0);

      IF ROUND(v_db_balance,2) != v_expected_balance OR ROUND(v_db_eligible,2) != v_expected_eligible OR ROUND(v_db_earned,2) != v_expected_earned OR ROUND(v_db_withdrawn,2) != v_expected_withdrawn THEN
        v_correction := jsonb_build_object('wallet_id', v_wallet.id, 'type', v_wallet.wallet_type,
          'before', jsonb_build_object('bal', v_db_balance, 'elig', v_db_eligible, 'earned', v_db_earned, 'wdrawn', v_db_withdrawn),
          'after', jsonb_build_object('bal', v_expected_balance, 'elig', v_expected_eligible, 'earned', v_expected_earned, 'wdrawn', v_expected_withdrawn));
        v_corrections := v_corrections || v_correction;
        IF NOT p_dry_run THEN
          ALTER TABLE wallets DISABLE TRIGGER prevent_balance_manipulation;
          IF p_environment = 'development' THEN
            UPDATE wallets SET test_balance=v_expected_balance, test_eligible_balance=v_expected_eligible, total_earned=v_expected_earned, total_withdrawn=v_expected_withdrawn, updated_at=NOW() WHERE id=v_wallet.id;
          ELSE
            UPDATE wallets SET balance=v_expected_balance, eligible_balance=v_expected_eligible, total_earned=v_expected_earned, total_withdrawn=v_expected_withdrawn, updated_at=NOW() WHERE id=v_wallet.id;
          END IF;
          ALTER TABLE wallets ENABLE TRIGGER prevent_balance_manipulation;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('count', jsonb_array_length(v_corrections), 'dry_run', p_dry_run, 'env', p_environment, 'corrections', v_corrections);
END;
$$
