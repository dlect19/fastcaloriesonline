# Rider search fails for vendor and admin — diagnosis and narrow fix

## Root cause (confirmed)

The `dispatch_requests` table still carries a leftover constraint `UNIQUE (order_id)`, while the current dispatch code is written to create **one row per dispatch round** and retire the previous ones (`status = 'superseded'`, linked through `superseded_by_request_id`). So the very first search for an order succeeds; every later search on the same order fails on insert.

Evidence:

- `pg_constraint`: `dispatch_requests_order_id_key UNIQUE (order_id)`.
- Edge logs for `dispatch-order`, repeatedly at 11:31:16, 11:38:05, 11:39:45 UTC today: `Error creating dispatch request: { code: "23505", details: "Key (order_id)=(2fc9ed13-…) already exists.", message: 'duplicate key value violates unique constraint "dispatch_requests_order_id_key"' }` followed by `Error in dispatch-order` — the function rethrows, returning 500, which the UI shows as "edge function error".
- Each failing run logs `Superseded 1 previous dispatch request(s)` immediately before, i.e. the code intends multiple rows.
- Everything before the insert worked: authorization passed, outlet pickup data resolved, destination `order_inline`, distance 1.0 km via Google Maps, `Found 5 eligible riders`, payout computed. So this is not auth, RLS, CORS, secrets, location, radius, or eligibility.
- `dispatch_requests` holds exactly one row per order across all history — the constraint has been silently capping it.
- Affected order: FC-260923-3568, paid, delivery, `searching_for_rider`, no rider, outlet and destination present; its single dispatch row expired at 11:40 and can no longer be replaced.

## Why both roles fail

Vendor (`src/components/vendor/DispatchStatus.tsx`, `src/components/vendor/ManualRiderAssignment.tsx`) and admin (`src/components/admin/AdminOrderTrackingDialog.tsx`) all invoke the same `dispatch-order` function. The failure is inside that function's insert, after the role check, so both paths fail identically. The minute-by-minute retry sweep re-dispatching expired rounds hits the same wall.

Scope: every order that needs a second dispatch attempt — expired round, no riders first time, rider reassignment, retry sweep. First-ever dispatch of a fresh order still works.

## Narrow fix

Additive migration `0035_allow_dispatch_rounds_per_order.sql`:

1. Drop `dispatch_requests_order_id_key` (the constraint only, no data touched).
2. Replace it with a partial unique index that keeps the real invariant — at most one live round per order:
   `CREATE UNIQUE INDEX dispatch_requests_one_live_per_order ON public.dispatch_requests (order_id) WHERE status IN ('pending','accepted');`
   This preserves idempotency (a second concurrent dispatch of the same order still collides) while allowing the superseded/expired/no_riders audit history the code already writes.
3. Index `(order_id, created_at DESC)` for the newest-round lookups, if not already present.

In `supabase/functions/dispatch-order/index.ts`: keep the existing supersede step ordered before the insert (it already is), and map a `23505` on the new partial index to a clear 409 response ("a rider search is already running for this order") instead of a 500, so a double click is reported honestly rather than as a server error.

Unchanged: role authorization, rider availability/verification filters, concurrency caps, distance and payout logic, destination resolution and failure handling, offer creation, retry sweep behaviour, and the exclusion of historical orders (no backfill, no re-dispatch of any past order).

## Restarting the stuck order

FC-260923-3568 is still paid and unassigned. After the migration, a normal vendor or admin "search for rider" on that order will work through the ordinary path. No manual assignment, no direct row edit, and no action on any other order.

## Tests

- Second dispatch round on the same order succeeds and marks the previous round superseded (currently fails with 23505).
- Two simultaneous dispatches of one order produce exactly one live round; the loser gets the 409 path, not a 500.
- An order with an accepted round cannot get a second live round.
- Expired/no_riders/superseded rows coexist for one order (audit history preserved).
- Role checks, availability filters and concurrency caps still refuse unauthorized callers and over-loaded riders.
