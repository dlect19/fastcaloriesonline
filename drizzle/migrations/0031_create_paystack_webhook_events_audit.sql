-- Append-only sanitized audit of every Paystack webhook attempt.
-- Deliberately stores NO secret keys, card PANs, authorization codes, bank
-- secrets, raw signatures or raw payloads.
CREATE TABLE public.paystack_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL,
  paystack_event_id TEXT,
  event_type TEXT NOT NULL,
  reference_masked TEXT,
  reference_full TEXT,
  purpose TEXT NOT NULL DEFAULT 'unknown'
    CHECK (purpose IN ('order_payment', 'wallet_funding', 'payout_transfer', 'unknown')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_number TEXT,
  wallet_transaction_id UUID,
  funding_user_id UUID,
  expected_amount NUMERIC,
  received_amount NUMERIC,
  currency TEXT,
  environment TEXT NOT NULL DEFAULT 'development',
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  processing_state TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received', 'verified', 'processed', 'rejected', 'failed', 'duplicate')),
  reason_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX paystack_webhook_events_dedupe_key_idx
  ON public.paystack_webhook_events (dedupe_key);
CREATE INDEX paystack_webhook_events_received_at_idx
  ON public.paystack_webhook_events (received_at DESC);
CREATE INDEX paystack_webhook_events_order_id_idx
  ON public.paystack_webhook_events (order_id);
CREATE INDEX paystack_webhook_events_purpose_idx
  ON public.paystack_webhook_events (purpose, processing_state);

-- Read-only for authenticated admins; every write goes through the webhook's
-- service role. No anon access at all.
GRANT SELECT ON public.paystack_webhook_events TO authenticated;
GRANT ALL ON public.paystack_webhook_events TO service_role;

ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read paystack webhook audit"
  ON public.paystack_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Append-only: identity/authenticity columns are immutable and rows can never
-- be deleted, so the audit trail cannot be rewritten after the fact.
CREATE OR REPLACE FUNCTION public.paystack_webhook_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'paystack_webhook_events is append-only';
  END IF;
  IF NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.signature_valid IS DISTINCT FROM OLD.signature_valid THEN
    RAISE EXCEPTION 'paystack_webhook_events identity columns are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER paystack_webhook_events_no_delete
  BEFORE DELETE ON public.paystack_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.paystack_webhook_events_append_only();

CREATE TRIGGER paystack_webhook_events_immutable_identity
  BEFORE UPDATE ON public.paystack_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.paystack_webhook_events_append_only();