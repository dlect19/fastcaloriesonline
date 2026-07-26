-- ============================================================
-- PART 1: Auto-credit voucher wallet at source
-- ============================================================

ALTER TABLE public.voucher_orders
  ADD COLUMN IF NOT EXISTS wallet_credited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wallet_credit_error TEXT;

CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order      public.voucher_orders%ROWTYPE;
  v_vendor     public.vendors%ROWTYPE;
  v_outlet_id  UUID;
  v_wallet     public.wallets%ROWTYPE;
  v_environment TEXT;
  v_is_test    BOOLEAN;
  v_net        NUMERIC;
  v_release_at TIMESTAMPTZ;
  v_released   BOOLEAN;
  v_reference  TEXT;
  v_balance_after NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.voucher_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'voucher order % not found', _order_id; END IF;

  IF v_order.status IS DISTINCT FROM 'paid' THEN
    RETURN;
  END IF;

  v_reference := 'VH-CREDIT-' || _order_id::text;

  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference = v_reference AND category = 'voucher_sale') THEN
    UPDATE public.voucher_orders
      SET wallet_credited_at = COALESCE(wallet_credited_at, NOW()),
          wallet_credit_error = NULL
      WHERE id = _order_id;
    RETURN;
  END IF;

  BEGIN
    SELECT * INTO v_vendor FROM public.vendors WHERE id = v_order.vendor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'vendor % not found', v_order.vendor_id; END IF;

    SELECT id INTO v_outlet_id FROM public.vendor_outlets
     WHERE vendor_id = v_vendor.id ORDER BY created_at ASC LIMIT 1;

    SELECT COALESCE(value, 'development') INTO v_environment
      FROM public.platform_settings WHERE key = 'platform_environment';
    v_is_test := v_environment = 'development';

    SELECT * INTO v_wallet FROM public.wallets
     WHERE user_id = v_vendor.user_id AND wallet_type = 'vendor'
       AND (outlet_id = v_outlet_id OR (outlet_id IS NULL AND v_outlet_id IS NULL))
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.wallets (user_id, wallet_type, outlet_id)
      VALUES (v_vendor.user_id, 'vendor', v_outlet_id)
      RETURNING * INTO v_wallet;
    END IF;

    v_net := v_order.amount - COALESCE(v_order.commission_amount, 0);
    v_release_at := public.vendor_settlement_release_at(NOW(), v_wallet.id);
    v_released := COALESCE(v_release_at, NOW()) <= NOW();

    IF v_released THEN
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_balance = COALESCE(test_menu_earnings_balance,0) + v_net,
          test_balance               = COALESCE(test_balance,0) + v_net,
          test_eligible_balance      = COALESCE(test_eligible_balance,0) + v_net,
          total_earned               = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id
        RETURNING test_balance INTO v_balance_after;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_balance = COALESCE(menu_earnings_balance,0) + v_net,
          balance               = COALESCE(balance,0) + v_net,
          eligible_balance      = COALESCE(eligible_balance,0) + v_net,
          total_earned          = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id
        RETURNING balance INTO v_balance_after;
      END IF;
    ELSE
      IF v_is_test THEN
        UPDATE public.wallets SET
          test_menu_earnings_pending = COALESCE(test_menu_earnings_pending,0) + v_net,
          test_pending_balance       = COALESCE(test_pending_balance,0) + v_net,
          total_earned               = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id
        RETURNING test_pending_balance INTO v_balance_after;
      ELSE
        UPDATE public.wallets SET
          menu_earnings_pending = COALESCE(menu_earnings_pending,0) + v_net,
          pending_balance       = COALESCE(pending_balance,0) + v_net,
          total_earned          = COALESCE(total_earned,0) + v_net,
          updated_at = NOW()
        WHERE id = v_wallet.id
        RETURNING pending_balance INTO v_balance_after;
      END IF;
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, wallet_type, transaction_type, category,
      amount, reference, status, environment, notes, metadata,
      release_at, balance_after
    ) VALUES (
      v_wallet.id, 'vendor', 'credit', 'voucher_sale',
      v_net, v_reference, 'completed', v_environment,
      'Voucher sale earnings',
      jsonb_build_object('voucher_order_id', _order_id, 'gross', v_order.amount, 'commission', v_order.commission_amount),
      v_release_at, COALESCE(v_balance_after, 0)
    );

    UPDATE public.voucher_orders
      SET wallet_credited_at = NOW(), wallet_credit_error = NULL
      WHERE id = _order_id;

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.voucher_orders
      SET wallet_credit_error = LEFT(SQLERRM, 500)
      WHERE id = _order_id;
    RAISE WARNING '[voucher-credit] order % failed: %', _order_id, SQLERRM;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_voucher_order_auto_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paid' AND NEW.wallet_credited_at IS NULL THEN
    PERFORM public.credit_vendor_wallet_for_voucher(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_voucher_order_auto_credit ON public.voucher_orders;
CREATE TRIGGER trg_voucher_order_auto_credit
AFTER INSERT OR UPDATE OF status ON public.voucher_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_voucher_order_auto_credit();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.voucher_orders WHERE status = 'paid' AND wallet_credited_at IS NULL
  LOOP
    PERFORM public.credit_vendor_wallet_for_voucher(r.id);
  END LOOP;
END $$;

-- ============================================================
-- PART 3: Voucher locations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voucher_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_locations TO authenticated;
GRANT SELECT ON public.voucher_locations TO anon;
GRANT ALL ON public.voucher_locations TO service_role;

ALTER TABLE public.voucher_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active voucher locations"
ON public.voucher_locations FOR SELECT
USING (is_active = true);

CREATE POLICY "Vendors manage their voucher locations"
ON public.voucher_locations FOR ALL
TO authenticated
USING (public.owns_vendor(auth.uid(), vendor_id))
WITH CHECK (public.owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Admins manage voucher locations"
ON public.voucher_locations FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_voucher_locations_vendor ON public.voucher_locations(vendor_id);

DROP TRIGGER IF EXISTS trg_voucher_locations_updated_at ON public.voucher_locations;
CREATE TRIGGER trg_voucher_locations_updated_at
BEFORE UPDATE ON public.voucher_locations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.voucher_categories
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.voucher_locations(id) ON DELETE CASCADE;

DO $$
DECLARE
  v_vendor_id UUID;
  v_loc_id UUID;
BEGIN
  FOR v_vendor_id IN
    SELECT DISTINCT vendor_id FROM public.voucher_categories WHERE location_id IS NULL
  LOOP
    SELECT id INTO v_loc_id
      FROM public.voucher_locations
     WHERE vendor_id = v_vendor_id AND name = 'Main'
     LIMIT 1;

    IF v_loc_id IS NULL THEN
      INSERT INTO public.voucher_locations (vendor_id, name)
      VALUES (v_vendor_id, 'Main')
      RETURNING id INTO v_loc_id;
    END IF;

    UPDATE public.voucher_categories
      SET location_id = v_loc_id
      WHERE vendor_id = v_vendor_id AND location_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE public.voucher_categories
  ALTER COLUMN location_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_categories_location ON public.voucher_categories(location_id);
