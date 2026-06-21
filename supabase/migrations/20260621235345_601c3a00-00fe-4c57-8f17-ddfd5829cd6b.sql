
ALTER TABLE public.order_item_addons
  ADD COLUMN IF NOT EXISTS is_refunded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount numeric,
  ADD COLUMN IF NOT EXISTS refund_reference text,
  ADD COLUMN IF NOT EXISTS substituted_with text,
  ADD COLUMN IF NOT EXISTS substitute_note text,
  ADD COLUMN IF NOT EXISTS substituted_at timestamptz;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS substituted_with text,
  ADD COLUMN IF NOT EXISTS substitute_note text,
  ADD COLUMN IF NOT EXISTS substituted_at timestamptz,
  ADD COLUMN IF NOT EXISTS substitute_refund_amount numeric;
