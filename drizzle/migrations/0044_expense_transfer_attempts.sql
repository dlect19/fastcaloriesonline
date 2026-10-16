ALTER TABLE public.expense_requisitions
  ADD COLUMN IF NOT EXISTS transfer_state text,
  ADD COLUMN IF NOT EXISTS transfer_reference text;

CREATE TABLE public.expense_transfer_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES public.expense_requisitions(id),
  reference text NOT NULL UNIQUE,
  environment text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  state text NOT NULL DEFAULT 'initiating'
    CHECK (state IN ('initiating','pending','unknown','success','failed','reversed')),
  source text NOT NULL DEFAULT 'process-expense',
  recipient_code text,
  transfer_code text,
  provider_message text,
  verified_snapshot jsonb,
  ledger_tx_id uuid,
  reversal_tx_id uuid,
  created_by uuid,
  last_event text,
  last_event_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expense_transfer_attempts TO authenticated;
GRANT ALL ON public.expense_transfer_attempts TO service_role;
ALTER TABLE public.expense_transfer_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read expense transfer attempts" ON public.expense_transfer_attempts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- At most one in-flight or successful attempt per requisition: blocks double "Pay".
CREATE UNIQUE INDEX expense_transfer_one_open_attempt
  ON public.expense_transfer_attempts(requisition_id)
  WHERE state IN ('initiating','pending','unknown','success');

ALTER TABLE public.paystack_webhook_events DROP CONSTRAINT paystack_webhook_events_purpose_check;
ALTER TABLE public.paystack_webhook_events ADD CONSTRAINT paystack_webhook_events_purpose_check
  CHECK (purpose = ANY (ARRAY['order_payment','wallet_funding','payout_transfer','expense_transfer','unknown']));

-- Durable attempt row BEFORE any external Paystack call.
CREATE OR REPLACE FUNCTION public.begin_expense_transfer(p_requisition_id uuid, p_reference text, p_actor uuid, p_source text DEFAULT 'process-expense')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_req RECORD; v_id uuid;
BEGIN
  SELECT * INTO v_req FROM public.expense_requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND'; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'EXPENSE_NOT_APPROVED'; END IF;
  IF EXISTS (SELECT 1 FROM public.expense_transfer_attempts WHERE requisition_id = p_requisition_id
             AND state IN ('initiating','pending','unknown','success')) THEN
    RAISE EXCEPTION 'EXPENSE_TRANSFER_IN_FLIGHT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_requests WHERE paystack_reference = p_reference) THEN
    RAISE EXCEPTION 'EXPENSE_REFERENCE_IN_USE';
  END IF;
  INSERT INTO public.expense_transfer_attempts(requisition_id, reference, environment, amount, state, source, created_by)
  VALUES (p_requisition_id, p_reference, v_req.environment, v_req.amount, 'initiating', p_source, p_actor)
  RETURNING id INTO v_id;
  UPDATE public.expense_requisitions SET transfer_state = 'initiating', transfer_reference = p_reference,
    payment_note = NULL, updated_at = now() WHERE id = p_requisition_id;
  RETURN v_id;
END $$;

-- Single authoritative state machine for webhook, initiation result and reconcile.
CREATE OR REPLACE FUNCTION public.record_expense_transfer_outcome(
  p_reference text, p_outcome text, p_transfer_code text DEFAULT NULL, p_message text DEFAULT NULL,
  p_amount_kobo bigint DEFAULT NULL, p_source text DEFAULT 'webhook', p_snapshot jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a RECORD; r RECORD; v_tx uuid; v_latest boolean;
BEGIN
  IF p_outcome NOT IN ('success','failed','reversed','pending','unknown') THEN
    RAISE EXCEPTION 'EXPENSE_BAD_OUTCOME';
  END IF;
  SELECT * INTO a FROM public.expense_transfer_attempts WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  SELECT * INTO r FROM public.expense_requisitions WHERE id = a.requisition_id FOR UPDATE;
  v_latest := (r.transfer_reference = a.reference);

  IF p_amount_kobo IS NOT NULL AND p_outcome IN ('success','reversed')
     AND p_amount_kobo <> round(a.amount * 100) THEN
    UPDATE public.expense_transfer_attempts SET last_event = p_source||':amount_mismatch:'||p_outcome,
      last_event_at = now(), updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('result','amount_mismatch');
  END IF;

  IF p_outcome = 'success' THEN
    IF a.state = 'success' THEN RETURN jsonb_build_object('result','noop','state',a.state); END IF;
    IF a.state = 'reversed' THEN RETURN jsonb_build_object('result','ignored_stale','state',a.state); END IF;
    IF r.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'EXPENSE_STATUS_INVALID %', r.status; END IF;
    UPDATE public.expense_transfer_attempts SET state='success',
      transfer_code = COALESCE(p_transfer_code, transfer_code),
      verified_snapshot = COALESCE(p_snapshot, verified_snapshot),
      last_event = p_source||':success', last_event_at = now(), finalized_at = now(), updated_at = now()
      WHERE id = a.id;
    UPDATE public.expense_requisitions SET status='paid', payment_method='paystack',
      paystack_reference = a.reference, paystack_transfer_code = COALESCE(p_transfer_code, a.transfer_code),
      transfer_state='success', transfer_reference = a.reference,
      paid_at = COALESCE(paid_at, now()), paid_by = COALESCE(paid_by, a.created_by),
      payment_note = CASE WHEN r.status='paid' AND r.paystack_reference IS DISTINCT FROM a.reference
                     THEN 'WARNING: additional successful transfer '||a.reference ELSE NULL END,
      updated_at = now() WHERE id = r.id;
    -- Idempotent by requisition: the expense is debited exactly once.
    v_tx := public.post_platform_entry(r.amount, 'expense', 'debit', 'EXP-'||r.id::text, r.environment,
      'completed', NULL, 'Expense: '||r.title,
      jsonb_build_object('requisition_id', r.id, 'expense_category', r.category, 'payment_method','paystack',
        'paystack_reference', a.reference, 'transfer_code', COALESCE(p_transfer_code, a.transfer_code),
        'source', 'record_expense_transfer_outcome:'||p_source));
    UPDATE public.expense_transfer_attempts SET ledger_tx_id = v_tx WHERE id = a.id;
    RETURN jsonb_build_object('result','applied','state','success','ledger_tx_id',v_tx);
  END IF;

  IF p_outcome = 'failed' THEN
    IF a.state = 'success' THEN
      UPDATE public.expense_transfer_attempts SET last_event = p_source||':stale_failed_ignored', last_event_at=now() WHERE id=a.id;
      RETURN jsonb_build_object('result','ignored_stale','state',a.state);
    END IF;
    IF a.state IN ('failed','reversed') THEN RETURN jsonb_build_object('result','noop','state',a.state); END IF;
    UPDATE public.expense_transfer_attempts SET state='failed', provider_message = left(p_message,300),
      last_event = p_source||':failed', last_event_at=now(), finalized_at=now(), updated_at=now() WHERE id=a.id;
    IF v_latest AND r.status = 'approved' THEN
      UPDATE public.expense_requisitions SET transfer_state='failed',
        payment_note = 'Paystack transfer failed: '||COALESCE(left(p_message,200),'unknown'), updated_at=now() WHERE id=r.id;
    END IF;
    RETURN jsonb_build_object('result','applied','state','failed');
  END IF;

  IF p_outcome = 'reversed' THEN
    IF a.state = 'reversed' THEN RETURN jsonb_build_object('result','noop','state',a.state); END IF;
    IF a.state = 'success' AND a.ledger_tx_id IS NOT NULL THEN
      v_tx := public.post_platform_entry(r.amount, 'expense', 'credit', 'EXP-REV-'||a.reference, r.environment,
        'completed', NULL, 'Expense transfer reversed: '||r.title,
        jsonb_build_object('requisition_id', r.id, 'paystack_reference', a.reference, 'source','transfer.reversed'));
      UPDATE public.expense_transfer_attempts SET reversal_tx_id = v_tx WHERE id=a.id;
      UPDATE public.expense_requisitions SET status='approved', paid_at=NULL, transfer_state='reversed',
        payment_note='Paystack transfer reversed — funds returned', updated_at=now() WHERE id=r.id;
    ELSIF v_latest AND r.status='approved' THEN
      UPDATE public.expense_requisitions SET transfer_state='reversed',
        payment_note='Paystack transfer reversed', updated_at=now() WHERE id=r.id;
    END IF;
    UPDATE public.expense_transfer_attempts SET state='reversed', last_event=p_source||':reversed',
      last_event_at=now(), finalized_at=now(), updated_at=now() WHERE id=a.id;
    RETURN jsonb_build_object('result','applied','state','reversed');
  END IF;

  -- pending / unknown only advance an attempt that has no terminal answer yet.
  IF (p_outcome='pending' AND a.state IN ('initiating','unknown'))
     OR (p_outcome='unknown' AND a.state='initiating') THEN
    UPDATE public.expense_transfer_attempts SET state=p_outcome,
      transfer_code = COALESCE(p_transfer_code, transfer_code), provider_message = left(p_message,300),
      last_event=p_source||':'||p_outcome, last_event_at=now(), updated_at=now() WHERE id=a.id;
    IF v_latest THEN
      UPDATE public.expense_requisitions SET transfer_state = CASE WHEN p_outcome='pending' THEN 'processing' ELSE 'unknown' END,
        updated_at=now() WHERE id=r.id;
    END IF;
    RETURN jsonb_build_object('result','applied','state',p_outcome);
  END IF;
  RETURN jsonb_build_object('result','noop','state',a.state);
END $$;

-- Historical adoption of a provider-verified transfer that was never recorded.
CREATE OR REPLACE FUNCTION public.adopt_expense_transfer(p_requisition_id uuid, p_reference text, p_transfer_code text, p_actor uuid, p_snapshot jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.expense_transfer_attempts WHERE reference = p_reference) THEN
    SELECT id INTO v_id FROM public.expense_transfer_attempts WHERE reference = p_reference AND requisition_id = p_requisition_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'EXPENSE_REFERENCE_IN_USE'; END IF;
    RETURN v_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.expense_requisitions WHERE paystack_reference = p_reference AND id <> p_requisition_id) THEN
    RAISE EXCEPTION 'EXPENSE_REFERENCE_IN_USE';
  END IF;
  v_id := public.begin_expense_transfer(p_requisition_id, p_reference, p_actor, 'historical_reconcile');
  UPDATE public.expense_transfer_attempts SET state='unknown', transfer_code=p_transfer_code,
    verified_snapshot=p_snapshot, updated_at=now() WHERE id=v_id;
  RETURN v_id;
END $$;

-- Manual "Mark Paid" must not race an in-flight Paystack transfer.
CREATE OR REPLACE FUNCTION public.guard_expense_manual_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status <> 'paid' AND NEW.payment_method = 'manual'
     AND EXISTS (SELECT 1 FROM public.expense_transfer_attempts WHERE requisition_id = NEW.id
                 AND state IN ('initiating','pending','unknown','success')) THEN
    RAISE EXCEPTION 'EXPENSE_TRANSFER_IN_FLIGHT: a Paystack transfer is pending; reconcile it instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_expense_manual_payment BEFORE UPDATE ON public.expense_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_manual_payment();

REVOKE ALL ON FUNCTION public.begin_expense_transfer(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_expense_transfer_outcome(text,text,text,text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adopt_expense_transfer(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_expense_transfer(uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_transfer_outcome(text,text,text,text,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.adopt_expense_transfer(uuid,text,text,uuid,jsonb) TO service_role;