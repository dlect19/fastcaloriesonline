-- Auto-generate 6-digit confirmation_code on order insert when missing
CREATE OR REPLACE FUNCTION public.set_order_confirmation_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_code IS NULL OR NEW.confirmation_code = '' THEN
    NEW.confirmation_code := LPAD((floor(random()*900000)+100000)::int::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_confirmation_code ON public.orders;
CREATE TRIGGER trg_set_order_confirmation_code
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_confirmation_code();

-- Backfill existing orders without a code
UPDATE public.orders
SET confirmation_code = LPAD((floor(random()*900000)+100000)::int::text, 6, '0')
WHERE confirmation_code IS NULL;