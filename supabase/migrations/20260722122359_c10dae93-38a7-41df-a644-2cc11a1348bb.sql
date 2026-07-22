
-- 1) Add 'voucher' to vendor_category enum (idempotent)
ALTER TYPE public.vendor_category ADD VALUE IF NOT EXISTS 'voucher';

-- 2) Add slug column to vendors for public storefront URLs
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vendors_slug_unique ON public.vendors (slug) WHERE slug IS NOT NULL;

-- Slug helper (kebab-case + short hash for uniqueness)
CREATE OR REPLACE FUNCTION public.generate_vendor_slug(_name TEXT, _vendor_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  base TEXT;
  suffix TEXT;
BEGIN
  base := lower(regexp_replace(coalesce(_name, 'vendor'), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  IF base = '' THEN base := 'vendor'; END IF;
  suffix := substr(replace(_vendor_id::text, '-', ''), 1, 6);
  RETURN base || '-' || suffix;
END;
$$;

-- Auto-populate slug on insert / when name changes and slug is null
CREATE OR REPLACE FUNCTION public.set_vendor_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_vendor_slug(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_vendor_slug ON public.vendors;
CREATE TRIGGER trg_set_vendor_slug
BEFORE INSERT OR UPDATE OF name ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_slug();

-- Backfill existing vendors
UPDATE public.vendors SET slug = public.generate_vendor_slug(name, id) WHERE slug IS NULL;

-- 3) SECURITY DEFINER helper to credit a vendor wallet for a voucher sale.
-- Reuses the standard `wallets` (vendor + outlet) + `wallet_transactions` ledger
-- so voucher earnings feed straight into the existing withdrawal flow.
CREATE OR REPLACE FUNCTION public.credit_vendor_wallet_for_voucher(_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order          public.voucher_orders%ROWTYPE;
  v_vendor         public.vendors%ROWTYPE;
  v_outlet_id      UUID;
  v_wallet         public.wallets%ROWTYPE;
  v_environment    TEXT;
  v_is_test        BOOLEAN;
  v_net_amount     NUMERIC;
  v_current        NUMERIC;
  v_new_balance    NUMERIC;
  v_reference      TEXT;
BEGIN
  SELECT * INTO v_order FROM public.voucher_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher order % not found', _order_id;
  END IF;

  -- Idempotency: skip if we've already credited this order
  v_reference := 'VH-CREDIT-' || _order_id::text;
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference = v_reference AND category = 'voucher_sale'
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_order.vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor % not found', v_order.vendor_id;
  END IF;

  -- Use the vendor's first outlet as the wallet key
  SELECT id INTO v_outlet_id
    FROM public.vendor_outlets
   WHERE vendor_id = v_vendor.id
   ORDER BY created_at ASC
   LIMIT 1;

  -- Environment
  SELECT value INTO v_environment FROM public.platform_settings WHERE key = 'platform_environment';
  v_environment := COALESCE(v_environment, 'development');
  v_is_test := v_environment = 'development';

  -- Get or create vendor wallet
  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE user_id = v_vendor.user_id
     AND wallet_type = 'vendor'
     AND (outlet_id = v_outlet_id OR (outlet_id IS NULL AND v_outlet_id IS NULL))
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, wallet_type, outlet_id)
    VALUES (v_vendor.user_id, 'vendor', v_outlet_id)
    RETURNING * INTO v_wallet;
  END IF;

  v_net_amount := v_order.amount - COALESCE(v_order.commission_amount, 0);

  IF v_is_test THEN
    v_current := COALESCE(v_wallet.test_balance, 0);
    v_new_balance := v_current + v_net_amount;
  ELSE
    v_current := COALESCE(v_wallet.balance, 0);
    v_new_balance := v_current + v_net_amount;
  END IF;

  -- Ledger row first (idempotent lock via reference uniqueness we just checked)
  INSERT INTO public.wallet_transactions (
    wallet_id, wallet_type, transaction_type, category,
    amount, balance_after, reference, status, environment, notes, metadata
  ) VALUES (
    v_wallet.id, 'vendor', 'credit', 'voucher_sale',
    v_net_amount, v_new_balance, v_reference, 'completed', v_environment,
    'Voucher sale earnings',
    jsonb_build_object('voucher_order_id', _order_id, 'gross', v_order.amount, 'commission', v_order.commission_amount)
  );

  -- Bump wallet balance (SECURITY DEFINER bypasses prevent_balance_manipulation)
  IF v_is_test THEN
    UPDATE public.wallets
       SET test_balance = v_new_balance, updated_at = now()
     WHERE id = v_wallet.id;
  ELSE
    UPDATE public.wallets
       SET balance = v_new_balance, updated_at = now()
     WHERE id = v_wallet.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_vendor_wallet_for_voucher(UUID) TO service_role;

-- 4) Allow guest voucher orders (buyer_user_id nullable + guest_email)
ALTER TABLE public.voucher_orders ALTER COLUMN buyer_user_id DROP NOT NULL;
ALTER TABLE public.voucher_orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE public.voucher_orders ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS voucher_orders_paystack_ref_uidx
  ON public.voucher_orders (paystack_reference) WHERE paystack_reference IS NOT NULL;

-- Public storefront needs read access to approved voucher vendors and their categories.
-- Anon read policy on vendors already exists broadly, but we make sure voucher-vendor
-- categories are readable so unauth users can browse the storefront.
DROP POLICY IF EXISTS "Public can view active voucher categories" ON public.voucher_categories;
CREATE POLICY "Public can view active voucher categories"
ON public.voucher_categories
FOR SELECT
TO anon, authenticated
USING (is_active = true);

GRANT SELECT ON public.voucher_categories TO anon;
