
CREATE OR REPLACE FUNCTION public.reconcile_event_organizer_wallet(_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total_credits numeric := 0;
  _pending_credits numeric := 0;
  _withdrawn numeric := 0;
  _completed_credits numeric := 0;
BEGIN
  -- Total of all credits ever (completed + pending + later voided shouldn't be counted, but we keep simple)
  SELECT COALESCE(SUM(amount),0) INTO _total_credits
    FROM wallet_transactions
    WHERE wallet_id = _wallet_id AND type='credit' AND status IN ('pending','completed');

  SELECT COALESCE(SUM(amount),0) INTO _completed_credits
    FROM wallet_transactions
    WHERE wallet_id = _wallet_id AND type='credit' AND status='completed';

  SELECT COALESCE(SUM(amount),0) INTO _pending_credits
    FROM payout_pending_releases
    WHERE wallet_id = _wallet_id AND released=false;

  SELECT COALESCE(SUM(-amount),0) INTO _withdrawn
    FROM wallet_transactions
    WHERE wallet_id = _wallet_id AND type='withdrawal' AND status IN ('completed','pending','processing');

  PERFORM set_config('app.bypass_balance_trigger','true', true);

  UPDATE wallets SET
    balance = GREATEST(0, _completed_credits - _withdrawn),
    eligible_balance = GREATEST(0, _completed_credits - _withdrawn),
    pending_balance = _pending_credits,
    total_earned = _total_credits,
    total_withdrawn = _withdrawn,
    updated_at = now()
  WHERE id = _wallet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_event_organizer_wallet(uuid) TO authenticated, service_role;

-- Update credit trigger to call reconcile
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
  IF TG_OP='UPDATE' AND OLD.payment_status::text = 'paid' THEN RETURN NEW; END IF;

  SELECT organizer_id INTO _organizer_id FROM events WHERE id = NEW.event_id;
  IF _organizer_id IS NULL THEN RETURN NEW; END IF;

  SELECT (value)::text::numeric INTO _platform_fee_pct
    FROM platform_settings WHERE key='event_organizer_platform_fee_pct';
  IF _platform_fee_pct IS NULL THEN _platform_fee_pct := 5; END IF;

  _net := round(COALESCE(NEW.total,0) * (1 - _platform_fee_pct/100.0));
  IF _net <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(payout_period_hours,
           (SELECT (value)::text::numeric::integer FROM platform_settings WHERE key='event_organizer_payout_period_hours'),
           48)
    INTO _hold_hours
    FROM event_organizers WHERE id = _organizer_id;

  _release_at := COALESCE(NEW.paid_at, now()) + (_hold_hours::text || ' hours')::interval;
  _env := COALESCE(NEW.environment, 'development');

  _wid := ensure_event_organizer_wallet(_organizer_id);

  INSERT INTO wallet_transactions(
    wallet_id, amount, type, status, description, reference_id, environment, metadata
  ) VALUES (
    _wid, _net, 'credit', 'pending',
    'Ticket sale credit (order ' || NEW.order_number || ')',
    NEW.id::text, _env,
    jsonb_build_object('source','event_ticket_sale','ticket_order_id', NEW.id, 'gross', NEW.total, 'fee_pct', _platform_fee_pct)
  ) RETURNING id INTO _tx_id;

  INSERT INTO payout_pending_releases(
    wallet_id, transaction_id, amount, wallet_type, category, earned_at, release_at, environment
  ) VALUES (
    _wid, _tx_id, _net, 'event_organizer', 'event_ticket_sale',
    COALESCE(NEW.paid_at, now()), _release_at, _env
  );

  PERFORM reconcile_event_organizer_wallet(_wid);
  RETURN NEW;
END;
$$;

-- Update release fn to reconcile after releasing
CREATE OR REPLACE FUNCTION public.release_event_organizer_matured_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
  r record;
  _wallets uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT id, wallet_id, transaction_id FROM payout_pending_releases
     WHERE wallet_type='event_organizer' AND released=false AND release_at <= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE wallet_transactions SET status='completed' WHERE id = r.transaction_id;
    UPDATE payout_pending_releases SET released=true, released_at=now() WHERE id = r.id;
    _wallets := array_append(_wallets, r.wallet_id);
    _count := _count + 1;
  END LOOP;

  IF array_length(_wallets,1) > 0 THEN
    PERFORM reconcile_event_organizer_wallet(w) FROM unnest(_wallets) w;
  END IF;
  RETURN _count;
END;
$$;
