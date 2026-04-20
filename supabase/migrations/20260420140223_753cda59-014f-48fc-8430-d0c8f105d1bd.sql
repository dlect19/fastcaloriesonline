ALTER TABLE public.wallet_transactions
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

UPDATE public.wallet_transactions
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.wallet_transactions
ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.wallet_transactions
ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS update_wallet_transactions_updated_at ON public.wallet_transactions;

CREATE TRIGGER update_wallet_transactions_updated_at
BEFORE UPDATE ON public.wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();