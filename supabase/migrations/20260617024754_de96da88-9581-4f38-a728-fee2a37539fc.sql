
-- 1. Organizer table extensions
ALTER TABLE public.event_organizers
  ADD COLUMN IF NOT EXISTS payout_period_hours integer,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code text;

-- 2. Platform settings (idempotent inserts)
INSERT INTO public.platform_settings (key, value)
SELECT 'event_organizer_payout_period_hours', to_jsonb(48)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key='event_organizer_payout_period_hours');

INSERT INTO public.platform_settings (key, value)
SELECT 'event_organizer_platform_fee_pct', to_jsonb(5)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key='event_organizer_platform_fee_pct');

INSERT INTO public.platform_settings (key, value)
SELECT 'event_organizer_minimum_payout', to_jsonb(1000)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key='event_organizer_minimum_payout');

-- 3. Wallets: add organizer_id column so we can key organizer wallets by organizer
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.event_organizers(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS wallets_unique_organizer
  ON public.wallets(organizer_id) WHERE wallet_type = 'event_organizer';

-- 4. Helper: ensure organizer wallet exists
CREATE OR REPLACE FUNCTION public.ensure_event_organizer_wallet(_organizer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
BEGIN
  SELECT id INTO wid FROM public.wallets
   WHERE organizer_id = _organizer_id AND wallet_type='event_organizer'
   LIMIT 1;
  IF wid IS NULL THEN
    INSERT INTO public.wallets(user_id, organizer_id, wallet_type, balance, pending_balance, eligible_balance, total_earned, total_withdrawn)
    VALUES (NULL, _organizer_id, 'event_organizer', 0, 0, 0, 0, 0)
    RETURNING id INTO wid;
  END IF;
  RETURN wid;
END;
$$;

-- 5. Trigger: credit organizer wallet when ticket order is paid
CREATE OR REPLACE FUNCTION public.credit_event_organizer_on_ticket_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _organizer_id uuid;
  _platform_fee_pct numeric;
  _net numeric;
  _wid uuid;
  _hold_hours integer;
  _release_at timestamptz;
  _tx_id uuid;
  _env text;
BEGIN
  IF NEW.payment_status::text <> 'paid' THEN RETURN NEW; END IF;
  IF OLD.payment_status::text = 'paid' THEN RETURN NEW; END IF;

  SELECT organizer_id INTO _organizer_id FROM public.events WHERE id = NEW.event_id;
  IF _organizer_id IS NULL THEN RETURN NEW; END IF;

  SELECT (value)::text::numeric INTO _platform_fee_pct
    FROM public.platform_settings WHERE key='event_organizer_platform_fee_pct';
  IF _platform_fee_pct IS NULL THEN _platform_fee_pct := 5; END IF;

  _net := round(COALESCE(NEW.total,0) * (1 - _platform_fee_pct/100.0));
  IF _net <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(payout_period_hours,
           (SELECT (value)::text::numeric::integer FROM public.platform_settings WHERE key='event_organizer_payout_period_hours'),
           48)
    INTO _hold_hours
    FROM public.event_organizers WHERE id = _organizer_id;

  _release_at := COALESCE(NEW.paid_at, now()) + (_hold_hours::text || ' hours')::interval;
  _env := COALESCE(NEW.environment, 'development');

  _wid := public.ensure_event_organizer_wallet(_organizer_id);

  INSERT INTO public.wallet_transactions(
    wallet_id, amount, type, status, description, reference_id, environment, metadata
  ) VALUES (
    _wid, _net, 'credit', 'pending',
    'Ticket sale credit (order ' || NEW.order_number || ')',
    NEW.id::text, _env,
    jsonb_build_object('source','event_ticket_sale','ticket_order_id', NEW.id, 'gross', NEW.total, 'fee_pct', _platform_fee_pct)
  ) RETURNING id INTO _tx_id;

  INSERT INTO public.payout_pending_releases(
    wallet_id, transaction_id, amount, wallet_type, category, earned_at, release_at, environment
  ) VALUES (
    _wid, _tx_id, _net, 'event_organizer', 'event_ticket_sale',
    COALESCE(NEW.paid_at, now()), _release_at, _env
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_event_organizer_on_ticket_paid ON public.event_ticket_orders;
CREATE TRIGGER trg_credit_event_organizer_on_ticket_paid
AFTER INSERT OR UPDATE OF payment_status ON public.event_ticket_orders
FOR EACH ROW EXECUTE FUNCTION public.credit_event_organizer_on_ticket_paid();

-- 6. Release-matured-holds function (callable from a cron edge fn or admin button)
CREATE OR REPLACE FUNCTION public.release_event_organizer_matured_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, wallet_id, amount FROM public.payout_pending_releases
     WHERE wallet_type='event_organizer' AND released=false AND release_at <= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    -- ledger: convert pending -> released (mark as completed)
    UPDATE public.wallet_transactions SET status='completed' WHERE id =
      (SELECT transaction_id FROM public.payout_pending_releases WHERE id = r.id);
    UPDATE public.payout_pending_releases SET released=true, released_at=now() WHERE id = r.id;
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;
$$;

-- 7. Allow process-payout to recognize event_organizer payouts: just ensure user_type column accepts the value (it's text, no enum).

-- 8. RLS for organizer wallet read by admins
-- wallets already has policies; add admin-can-read-all if not present is handled by existing helpers.
-- Add explicit policy for organizer wallets readable by admins.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='wallets'
      AND policyname='Admins can view organizer wallets'
  ) THEN
    EXECUTE $p$CREATE POLICY "Admins can view organizer wallets" ON public.wallets
      FOR SELECT TO authenticated
      USING (wallet_type='event_organizer' AND public.has_role(auth.uid(), 'admin'))$p$;
  END IF;
END $$;

-- 9. Grants (tables already granted; functions need execute)
GRANT EXECUTE ON FUNCTION public.ensure_event_organizer_wallet(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_event_organizer_matured_holds() TO authenticated, service_role;
