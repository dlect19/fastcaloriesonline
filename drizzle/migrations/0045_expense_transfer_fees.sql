ALTER TABLE public.expense_transfer_attempts
  ADD COLUMN IF NOT EXISTS fee_kobo bigint CHECK (fee_kobo IS NULL OR fee_kobo >= 0),
  ADD COLUMN IF NOT EXISTS fee_tx_id uuid,
  ADD COLUMN IF NOT EXISTS fee_refund_kobo bigint CHECK (fee_refund_kobo IS NULL OR fee_refund_kobo >= 0),
  ADD COLUMN IF NOT EXISTS fee_refund_tx_id uuid,
  ADD COLUMN IF NOT EXISTS fee_evidence jsonb;

-- Provider-confirmed Paystack transfer fee, posted once as a separate company debit.
-- Never computes or guesses a fee; the caller passes the verified kobo amount.
CREATE OR REPLACE FUNCTION public.record_expense_transfer_fee(p_reference text, p_fee_kobo bigint, p_source text, p_evidence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a RECORD; r RECORD; v_tx uuid;
BEGIN
  IF p_fee_kobo IS NULL OR p_fee_kobo < 0 THEN RAISE EXCEPTION 'EXPENSE_FEE_INVALID'; END IF;
  SELECT * INTO a FROM public.expense_transfer_attempts WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF a.state <> 'success' OR a.ledger_tx_id IS NULL THEN
    RETURN jsonb_build_object('result','not_successful','state',a.state);
  END IF;
  IF a.fee_kobo IS NOT NULL THEN
    IF a.fee_kobo = p_fee_kobo THEN RETURN jsonb_build_object('result','noop','fee_tx_id',a.fee_tx_id); END IF;
    UPDATE public.expense_transfer_attempts SET last_event = p_source||':fee_conflict:'||p_fee_kobo,
      last_event_at = now(), updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('result','fee_conflict','recorded_fee_kobo',a.fee_kobo);
  END IF;
  SELECT * INTO r FROM public.expense_requisitions WHERE id = a.requisition_id;
  IF p_fee_kobo > 0 THEN
    v_tx := public.post_platform_entry(p_fee_kobo::numeric / 100, 'expense_fee', 'debit', 'EXPFEE-'||a.reference,
      a.environment, 'completed', NULL, 'Paystack transfer fee: '||r.title,
      jsonb_build_object('requisition_id', r.id, 'paystack_reference', a.reference,
        'principal_tx_id', a.ledger_tx_id, 'fee_kobo', p_fee_kobo, 'source', p_source));
  END IF;
  UPDATE public.expense_transfer_attempts SET fee_kobo = p_fee_kobo, fee_tx_id = v_tx,
    fee_evidence = p_evidence, last_event = p_source||':fee_recorded', last_event_at = now(), updated_at = now()
    WHERE id = a.id;
  RETURN jsonb_build_object('result','applied','fee_tx_id',v_tx,'fee_kobo',p_fee_kobo);
END $$;

-- Fee refund only for an explicit provider-confirmed amount; never assumed on reversal.
CREATE OR REPLACE FUNCTION public.record_expense_transfer_fee_refund(p_reference text, p_refund_kobo bigint, p_source text, p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a RECORD; v_tx uuid;
BEGIN
  IF p_refund_kobo IS NULL OR p_refund_kobo <= 0 OR p_evidence IS NULL THEN RAISE EXCEPTION 'EXPENSE_FEE_REFUND_INVALID'; END IF;
  SELECT * INTO a FROM public.expense_transfer_attempts WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF a.fee_tx_id IS NULL OR a.fee_kobo IS NULL THEN RETURN jsonb_build_object('result','no_fee_recorded'); END IF;
  IF p_refund_kobo > a.fee_kobo THEN RETURN jsonb_build_object('result','exceeds_fee'); END IF;
  IF a.fee_refund_tx_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', CASE WHEN a.fee_refund_kobo = p_refund_kobo THEN 'noop' ELSE 'refund_conflict' END);
  END IF;
  v_tx := public.post_platform_entry(p_refund_kobo::numeric / 100, 'expense_fee', 'credit', 'EXPFEE-REV-'||a.reference,
    a.environment, 'completed', NULL, 'Paystack transfer fee refunded',
    jsonb_build_object('requisition_id', a.requisition_id, 'paystack_reference', a.reference,
      'fee_tx_id', a.fee_tx_id, 'refund_kobo', p_refund_kobo, 'source', p_source));
  UPDATE public.expense_transfer_attempts SET fee_refund_kobo = p_refund_kobo, fee_refund_tx_id = v_tx,
    fee_evidence = COALESCE(fee_evidence,'{}'::jsonb) || jsonb_build_object('refund', p_evidence),
    last_event = p_source||':fee_refunded', last_event_at = now(), updated_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('result','applied','fee_refund_tx_id',v_tx);
END $$;

REVOKE ALL ON FUNCTION public.record_expense_transfer_fee(text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_expense_transfer_fee_refund(text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_transfer_fee(text,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_transfer_fee_refund(text,bigint,text,jsonb) TO service_role;