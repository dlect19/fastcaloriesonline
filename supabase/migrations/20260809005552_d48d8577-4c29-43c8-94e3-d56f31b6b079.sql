-- 1) Repair vendor/rider revenue buckets so they never exceed real balance
CREATE OR REPLACE FUNCTION public.repair_wallet_revenue_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
  v_menu numeric;
  v_rider numeric;
  v_ref numeric;
  v_sum numeric;
BEGIN
  FOR r IN
    SELECT id, wallet_type, coalesce(balance,0) AS balance,
           coalesce(menu_earnings_balance,0) AS menu,
           coalesce(rider_revenue_balance,0) AS rider,
           coalesce(referral_bonus_balance,0) AS referral
    FROM public.wallets
    WHERE wallet_type IN ('vendor','rider','delivery_company')
  LOOP
    v_ref := greatest(0, least(r.referral, greatest(r.balance,0)));
    v_menu := greatest(0, r.menu);
    v_rider := greatest(0, r.rider);
    v_sum := v_menu + v_rider;
    -- amount available to allocate across revenue buckets
    DECLARE
      v_avail numeric := greatest(0, greatest(r.balance,0) - v_ref);
    BEGIN
      IF v_sum = 0 THEN
        IF r.wallet_type = 'vendor' THEN
          v_menu := v_avail; v_rider := 0;
        ELSE
          v_rider := v_avail; v_menu := 0;
        END IF;
      ELSE
        v_menu := round(v_avail * (v_menu / v_sum), 2);
        v_rider := round(v_avail - v_menu, 2);
      END IF;
    END;

    IF abs(v_menu - r.menu) > 0.009 OR abs(v_rider - r.rider) > 0.009 OR abs(v_ref - r.referral) > 0.009 THEN
      PERFORM set_config('app.bypass_balance_guard', 'on', true);
      UPDATE public.wallets
      SET menu_earnings_balance = v_menu,
          rider_revenue_balance = v_rider,
          referral_bonus_balance = v_ref
      WHERE id = r.id;
      PERFORM set_config('app.bypass_balance_guard', 'off', true);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_wallet_revenue_buckets() FROM public;
GRANT EXECUTE ON FUNCTION public.repair_wallet_revenue_buckets() TO service_role;

SELECT public.repair_wallet_revenue_buckets();

-- keep buckets clamped to balance on every balance change
CREATE OR REPLACE FUNCTION public.clamp_revenue_buckets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bal numeric;
  v_menu numeric;
  v_rider numeric;
  v_ref numeric;
  v_sum numeric;
  v_avail numeric;
BEGIN
  IF NEW.wallet_type NOT IN ('vendor','rider','delivery_company') THEN
    RETURN NEW;
  END IF;

  v_bal := greatest(coalesce(NEW.balance,0), 0);
  v_ref := greatest(0, least(coalesce(NEW.referral_bonus_balance,0), v_bal));
  v_avail := greatest(0, v_bal - v_ref);
  v_menu := greatest(0, coalesce(NEW.menu_earnings_balance,0));
  v_rider := greatest(0, coalesce(NEW.rider_revenue_balance,0));
  v_sum := v_menu + v_rider;

  IF v_sum > v_avail THEN
    IF v_sum = 0 THEN
      v_menu := 0; v_rider := 0;
    ELSE
      v_menu := round(v_avail * (v_menu / v_sum), 2);
      v_rider := round(v_avail - v_menu, 2);
    END IF;
    NEW.menu_earnings_balance := v_menu;
    NEW.rider_revenue_balance := v_rider;
  END IF;

  NEW.referral_bonus_balance := v_ref;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clamp_revenue_buckets ON public.wallets;
CREATE TRIGGER trg_clamp_revenue_buckets
BEFORE INSERT OR UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.clamp_revenue_buckets();

-- 2) Portion sizes (liters / plates) for menu items
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS portion_unit text DEFAULT 'plate',
  ADD COLUMN IF NOT EXISTS base_portion_size numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS preorder_lead_days integer;

ALTER TABLE public.products
  ADD CONSTRAINT products_fulfillment_type_check
  CHECK (fulfillment_type IN ('instant','preorder'));

CREATE TABLE IF NOT EXISTS public.product_portions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text NOT NULL,
  portion_size numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'litre',
  price numeric(12,2) NOT NULL,
  calorie_multiplier numeric,
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_portions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_portions TO authenticated;
GRANT ALL ON public.product_portions TO service_role;

ALTER TABLE public.product_portions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view product portions"
ON public.product_portions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_portions.product_id AND p.is_hidden = false
  )
  OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_portions.product_id
      AND public.owns_vendor(auth.uid(), p.vendor_id)
  )
);

CREATE POLICY "Vendors manage their product portions"
ON public.product_portions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_portions.product_id AND public.owns_vendor(auth.uid(), p.vendor_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_portions.product_id AND public.owns_vendor(auth.uid(), p.vendor_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_portions_product ON public.product_portions(product_id);

CREATE TRIGGER update_product_portions_updated_at
BEFORE UPDATE ON public.product_portions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- order items record the chosen portion
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS portion_label text,
  ADD COLUMN IF NOT EXISTS portion_size numeric,
  ADD COLUMN IF NOT EXISTS portion_unit text;

-- 3) Pre-order support for social-media vendors
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS is_social_vendor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fulfillment_mode text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS default_preorder_lead_days integer DEFAULT 1;

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_fulfillment_mode_check
  CHECK (fulfillment_mode IN ('instant','preorder','both'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_preorder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS prep_days integer;