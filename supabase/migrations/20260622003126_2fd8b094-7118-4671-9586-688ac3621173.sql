
-- =====================================================================
-- 1) Lock delivery OTP (confirmation_code) from being changed after insert
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lock_order_confirmation_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Once an order has a confirmation_code, do not allow it to change.
  IF OLD.confirmation_code IS NOT NULL AND OLD.confirmation_code <> '' THEN
    IF NEW.confirmation_code IS DISTINCT FROM OLD.confirmation_code THEN
      NEW.confirmation_code := OLD.confirmation_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_order_confirmation_code ON public.orders;
CREATE TRIGGER trg_lock_order_confirmation_code
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.lock_order_confirmation_code();

-- =====================================================================
-- 2) Shadow customer credits — refunds for unregistered assisted-order
--    customers. Held by phone; auto-credits the user's wallet when they
--    sign up later with the same phone.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.shadow_customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  environment TEXT NOT NULL DEFAULT 'development',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','cancelled','settled_offline')),
  source TEXT NOT NULL DEFAULT 'assisted_refund',
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  reason TEXT,
  notes TEXT,
  created_by UUID,
  claimed_at TIMESTAMPTZ,
  claimed_user_id UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shadow_credits_phone_status
  ON public.shadow_customer_credits(phone, status);
CREATE INDEX IF NOT EXISTS idx_shadow_credits_order
  ON public.shadow_customer_credits(order_id);

GRANT SELECT, INSERT, UPDATE ON public.shadow_customer_credits TO authenticated;
GRANT ALL ON public.shadow_customer_credits TO service_role;

ALTER TABLE public.shadow_customer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage shadow credits"
ON public.shadow_customer_credits
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_shadow_credits_updated_at
BEFORE UPDATE ON public.shadow_customer_credits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-claim shadow credits when a profile is created/updated with matching phone
CREATE OR REPLACE FUNCTION public.auto_claim_shadow_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_wallet_id UUID;
  v_balance NUMERIC;
  v_new_balance NUMERIC;
  v_is_test BOOLEAN;
  v_ref TEXT;
  v_normalized TEXT;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  v_normalized := regexp_replace(NEW.phone, '\D', '', 'g');

  FOR rec IN
    SELECT * FROM public.shadow_customer_credits
    WHERE status = 'pending'
      AND regexp_replace(phone, '\D', '', 'g') = v_normalized
  LOOP
    -- Ensure wallet exists
    SELECT id, balance, test_balance INTO v_wallet_id, v_balance, v_new_balance
    FROM public.wallets
    WHERE user_id = NEW.user_id AND wallet_type = 'customer'
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, wallet_type, balance, test_balance)
      VALUES (NEW.user_id, 'customer', 0, 0)
      RETURNING id INTO v_wallet_id;
      v_balance := 0;
      v_new_balance := 0;
    END IF;

    v_is_test := (rec.environment <> 'production');
    SELECT balance, test_balance INTO v_balance, v_new_balance
      FROM public.wallets WHERE id = v_wallet_id;

    IF v_is_test THEN
      v_new_balance := COALESCE(v_new_balance, 0) + rec.amount;
      v_ref := 'SHADOW-' || substr(rec.id::text, 1, 8) || '-' || extract(epoch from now())::bigint;
      INSERT INTO public.wallet_transactions (
        wallet_id, wallet_type, transaction_type, category, amount,
        balance_after, reference, order_id, status, environment, notes
      ) VALUES (
        v_wallet_id, 'customer', 'credit', 'refund', rec.amount,
        v_new_balance, v_ref, rec.order_id, 'completed', rec.environment,
        'Auto-claimed shadow refund credit: ' || COALESCE(rec.reason, 'pending refund')
      );
      UPDATE public.wallets SET test_balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
    ELSE
      v_new_balance := COALESCE(v_balance, 0) + rec.amount;
      v_ref := 'SHADOW-' || substr(rec.id::text, 1, 8) || '-' || extract(epoch from now())::bigint;
      INSERT INTO public.wallet_transactions (
        wallet_id, wallet_type, transaction_type, category, amount,
        balance_after, reference, order_id, status, environment, notes
      ) VALUES (
        v_wallet_id, 'customer', 'credit', 'refund', rec.amount,
        v_new_balance, v_ref, rec.order_id, 'completed', rec.environment,
        'Auto-claimed shadow refund credit: ' || COALESCE(rec.reason, 'pending refund')
      );
      UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
    END IF;

    UPDATE public.shadow_customer_credits
    SET status = 'claimed',
        claimed_at = now(),
        claimed_user_id = NEW.user_id,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_claim_shadow_credits_insert ON public.profiles;
CREATE TRIGGER trg_auto_claim_shadow_credits_insert
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.auto_claim_shadow_credits();

DROP TRIGGER IF EXISTS trg_auto_claim_shadow_credits_update ON public.profiles;
CREATE TRIGGER trg_auto_claim_shadow_credits_update
AFTER UPDATE OF phone ON public.profiles
FOR EACH ROW
WHEN (NEW.phone IS DISTINCT FROM OLD.phone)
EXECUTE FUNCTION public.auto_claim_shadow_credits();

-- =====================================================================
-- 3) Auto-link event organizers to existing user accounts by email/phone
-- =====================================================================
CREATE OR REPLACE FUNCTION public.auto_link_event_organizer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_norm_phone TEXT;
BEGIN
  IF NEW.owner_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Try match by email (auth.users)
  IF NEW.contact_email IS NOT NULL AND NEW.contact_email <> '' THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(NEW.contact_email)
    LIMIT 1;
  END IF;

  -- Fall back to phone (profiles)
  IF v_user_id IS NULL AND NEW.contact_phone IS NOT NULL AND NEW.contact_phone <> '' THEN
    v_norm_phone := regexp_replace(NEW.contact_phone, '\D', '', 'g');
    SELECT user_id INTO v_user_id
    FROM public.profiles
    WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_norm_phone
    LIMIT 1;
  END IF;

  IF v_user_id IS NOT NULL THEN
    NEW.owner_user_id := v_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_event_organizer ON public.event_organizers;
CREATE TRIGGER trg_auto_link_event_organizer
BEFORE INSERT ON public.event_organizers
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_event_organizer();
