-- Rider search could only ever run once per order: a leftover UNIQUE(order_id)
-- on dispatch_requests conflicted with the runtime's supersede-then-insert
-- rounds model, so every retry failed with 23505 and the UI showed a 500.
-- The real invariant is "at most one LIVE round per order"; superseded /
-- expired / no_riders rounds are audit history and must coexist.

ALTER TABLE public.dispatch_requests
  DROP CONSTRAINT IF EXISTS dispatch_requests_order_id_key;

-- Live = exactly the statuses the runtime treats as active
-- (public.dispatch_sweep_expiry retires 'pending' and 'no_riders'; only
-- 'pending' and 'accepted' block a new round). NULL status defaults to pending.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_requests_one_live_per_order
  ON public.dispatch_requests (order_id)
  WHERE COALESCE(status, 'pending') IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS idx_dispatch_requests_order_created
  ON public.dispatch_requests (order_id, created_at DESC);

COMMENT ON INDEX public.dispatch_requests_one_live_per_order IS
  'At most one live (pending/accepted) dispatch round per order; superseded, expired and no_riders rounds are retained history.';
