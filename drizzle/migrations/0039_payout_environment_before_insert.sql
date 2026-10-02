CREATE OR REPLACE FUNCTION public.set_payout_request_environment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.environment := CASE WHEN public.get_platform_environment() = 'development' THEN 'development' ELSE 'production' END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_set_payout_request_environment ON public.payout_requests;
CREATE TRIGGER aa_set_payout_request_environment
  BEFORE INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_payout_request_environment();

CREATE OR REPLACE FUNCTION public.assert_payout_has_ledger_debit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.wallet_transactions
  WHERE wallet_id = NEW.wallet_id
    AND reference = 'PAYOUT-REQ-' || NEW.id::text
    AND category = 'withdrawal' AND transaction_type = 'debit'
    AND status = 'completed' AND amount = NEW.amount;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_MISMATCH: payout % has % matching ledger debits (expected 1)', NEW.id, v_n;
  END IF;
  RETURN NULL;
END;
$function$;