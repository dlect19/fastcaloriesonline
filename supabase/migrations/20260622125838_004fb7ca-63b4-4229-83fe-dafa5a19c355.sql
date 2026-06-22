
CREATE TABLE IF NOT EXISTS public.ledger_adjustments_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID,
  order_number TEXT,
  scope TEXT NOT NULL, -- vendor_share | platform_commission | rider_share | payout_release | refund | substitute | other
  wallet_kind TEXT,    -- vendor | platform | rider | customer | delivery_company
  wallet_id UUID,
  transaction_id UUID,
  before_amount NUMERIC(14,2),
  after_amount NUMERIC(14,2),
  delta NUMERIC(14,2),
  reason TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  performed_by UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_adj_audit_order ON public.ledger_adjustments_audit(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_adj_audit_created ON public.ledger_adjustments_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_adj_audit_scope ON public.ledger_adjustments_audit(scope);

GRANT SELECT ON public.ledger_adjustments_audit TO authenticated;
GRANT ALL ON public.ledger_adjustments_audit TO service_role;

ALTER TABLE public.ledger_adjustments_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view ledger audit" ON public.ledger_adjustments_audit;
CREATE POLICY "Admins can view ledger audit"
  ON public.ledger_adjustments_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role manages ledger audit" ON public.ledger_adjustments_audit;
CREATE POLICY "Service role manages ledger audit"
  ON public.ledger_adjustments_audit FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Update adjust function to write audit rows
CREATE OR REPLACE FUNCTION public.adjust_vendor_payout_after_refund(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_is_test BOOLEAN;
  v_menu NUMERIC;
  v_pack NUMERIC;
  v_promo NUMERIC;
  v_service NUMERIC;
  v_rate NUMERIC;
  v_gross_commission NUMERIC;
  v_platform_commission NUMERIC;
  v_new_vendor_share NUMERIC;
  v_new_company_revenue NUMERIC;
  v_vs_tx RECORD;
  v_pc_tx RECORD;
  v_vs_delta NUMERIC;
  v_pc_delta NUMERIC;
  v_wallet_id UUID;
  v_pw_id UUID;
  v_actor UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','order not found'); END IF;

  IF COALESCE(v_order.channel,'') = 'pos' OR v_order.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  v_actor   := auth.uid();
  v_is_test := (v_order.environment = 'development');
  v_menu    := COALESCE(v_order.menu_subtotal, v_order.subtotal, 0);
  v_pack    := COALESCE(v_order.packaging_fee, 0);
  v_promo   := COALESCE(v_order.discount, 0);
  v_service := COALESCE(v_order.service_fee, 0);

  v_rate := resolve_commission_rate('vendor', v_order.vendor_id);
  v_gross_commission := ROUND(v_menu * (v_rate/100.0), 2);
  v_platform_commission := GREATEST(0, v_gross_commission - v_promo);
  v_new_vendor_share := v_menu - v_platform_commission + v_pack;
  v_new_company_revenue := v_platform_commission + v_service;
  IF v_promo > v_gross_commission THEN
    v_new_company_revenue := v_new_company_revenue - (v_promo - v_gross_commission);
  END IF;

  PERFORM set_config('app.bypass_balance_trigger', 'true', true);

  SELECT * INTO v_vs_tx FROM wallet_transactions
   WHERE order_id = p_order_id AND category = 'vendor_share'
   ORDER BY created_at LIMIT 1;

  IF FOUND THEN
    v_vs_delta := v_new_vendor_share - v_vs_tx.amount;
    v_wallet_id := v_vs_tx.wallet_id;

    IF v_vs_delta <> 0 THEN
      IF v_vs_tx.status = 'pending' THEN
        IF v_is_test THEN
          UPDATE wallets SET
            test_pending_balance = COALESCE(test_pending_balance,0) + v_vs_delta,
            test_menu_earnings_pending = COALESCE(test_menu_earnings_pending,0) + v_vs_delta,
            updated_at = NOW()
          WHERE id = v_wallet_id;
        ELSE
          UPDATE wallets SET
            pending_balance = COALESCE(pending_balance,0) + v_vs_delta,
            menu_earnings_pending = COALESCE(menu_earnings_pending,0) + v_vs_delta,
            total_earned = COALESCE(total_earned,0) + v_vs_delta,
            updated_at = NOW()
          WHERE id = v_wallet_id;
        END IF;

        UPDATE wallet_transactions
           SET amount = v_new_vendor_share,
               notes = COALESCE(notes,'') || ' [adjusted after refund: was ₦' || v_vs_tx.amount || ', now ₦' || v_new_vendor_share || ']'
         WHERE id = v_vs_tx.id;

        UPDATE payout_pending_releases
           SET amount = v_new_vendor_share, updated_at = NOW()
         WHERE transaction_id = v_vs_tx.id;

        INSERT INTO ledger_adjustments_audit(
          order_id, order_number, scope, wallet_kind, wallet_id, transaction_id,
          before_amount, after_amount, delta, reason, environment, performed_by, metadata
        ) VALUES (
          p_order_id, v_order.order_number, 'payout_release', 'vendor', v_wallet_id, v_vs_tx.id,
          v_vs_tx.amount, v_new_vendor_share, v_vs_delta,
          'Vendor pending payout adjusted after refund/substitute',
          v_order.environment, v_actor,
          jsonb_build_object('menu_subtotal', v_menu, 'packaging_fee', v_pack, 'commission', v_platform_commission)
        );
      ELSE
        IF v_is_test THEN
          UPDATE wallets SET
            test_balance = COALESCE(test_balance,0) + v_vs_delta,
            test_eligible_balance = COALESCE(test_eligible_balance,0) + v_vs_delta,
            test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) + v_vs_delta,
            updated_at = NOW()
          WHERE id = v_wallet_id;
        ELSE
          UPDATE wallets SET
            balance = COALESCE(balance,0) + v_vs_delta,
            eligible_balance = COALESCE(eligible_balance,0) + v_vs_delta,
            menu_earnings_balance = COALESCE(menu_earnings_balance,0) + v_vs_delta,
            total_earned = COALESCE(total_earned,0) + v_vs_delta,
            updated_at = NOW()
          WHERE id = v_wallet_id;
        END IF;

        INSERT INTO wallet_transactions (
          wallet_type, category, transaction_type, amount, order_id,
          wallet_id, environment, status, notes
        ) VALUES (
          'vendor', 'refund_adjustment',
          CASE WHEN v_vs_delta < 0 THEN 'debit' ELSE 'credit' END,
          ABS(v_vs_delta), p_order_id, v_wallet_id, v_order.environment, 'completed',
          'Vendor share adjustment after refund for order #' || v_order.order_number ||
          ' (was ₦' || v_vs_tx.amount || ', now ₦' || v_new_vendor_share || ')'
        );

        INSERT INTO ledger_adjustments_audit(
          order_id, order_number, scope, wallet_kind, wallet_id, transaction_id,
          before_amount, after_amount, delta, reason, environment, performed_by, metadata
        ) VALUES (
          p_order_id, v_order.order_number, 'vendor_share', 'vendor', v_wallet_id, v_vs_tx.id,
          v_vs_tx.amount, v_new_vendor_share, v_vs_delta,
          'Vendor earnings adjusted after refund/substitute (already released)',
          v_order.environment, v_actor,
          jsonb_build_object('menu_subtotal', v_menu, 'packaging_fee', v_pack, 'commission', v_platform_commission)
        );
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_pc_tx FROM wallet_transactions
   WHERE order_id = p_order_id AND category = 'platform_commission'
   ORDER BY created_at LIMIT 1;

  IF FOUND THEN
    v_pc_delta := v_new_company_revenue - v_pc_tx.amount;
    v_pw_id := v_pc_tx.platform_wallet_id;
    IF v_pc_delta <> 0 AND v_pw_id IS NOT NULL THEN
      IF v_is_test THEN
        UPDATE platform_wallet SET test_balance = COALESCE(test_balance,0) + v_pc_delta, updated_at = NOW()
         WHERE id = v_pw_id;
      ELSE
        UPDATE platform_wallet SET balance = COALESCE(balance,0) + v_pc_delta, updated_at = NOW()
         WHERE id = v_pw_id;
      END IF;
      UPDATE wallet_transactions
         SET amount = v_new_company_revenue,
             notes = COALESCE(notes,'') || ' [adjusted after refund: was ₦' || v_pc_tx.amount || ', now ₦' || v_new_company_revenue || ']'
       WHERE id = v_pc_tx.id;

      INSERT INTO ledger_adjustments_audit(
        order_id, order_number, scope, wallet_kind, wallet_id, transaction_id,
        before_amount, after_amount, delta, reason, environment, performed_by, metadata
      ) VALUES (
        p_order_id, v_order.order_number, 'platform_commission', 'platform', v_pw_id, v_pc_tx.id,
        v_pc_tx.amount, v_new_company_revenue, v_pc_delta,
        'Platform revenue recomputed after refund/substitute',
        v_order.environment, v_actor,
        jsonb_build_object('commission', v_platform_commission, 'service_fee', v_service, 'promo', v_promo)
      );
    END IF;
  END IF;

  UPDATE order_financials SET
    menu_price = v_menu,
    vendor_commission_amount = v_platform_commission,
    promo_discount_amount = v_promo,
    vendor_payout = v_new_vendor_share,
    company_revenue = v_new_company_revenue,
    revenue_status = CASE
      WHEN v_new_company_revenue > 0 THEN 'profit'
      WHEN v_new_company_revenue = 0 THEN 'break_even'
      ELSE 'loss' END,
    service_fee_amount = v_service
  WHERE order_id = p_order_id;

  PERFORM set_config('app.bypass_balance_trigger', 'false', true);

  RETURN jsonb_build_object(
    'order_number', v_order.order_number,
    'new_vendor_share', v_new_vendor_share,
    'new_company_revenue', v_new_company_revenue,
    'vendor_share_delta', v_vs_delta,
    'platform_delta', v_pc_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_vendor_payout_after_refund(uuid) TO service_role, authenticated;
