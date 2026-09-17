# Second checkout hardening patch — partial

Applied migration: `0023_lock_online_delivery_quote_consumption.sql` adds a row lock to the online integrity guard's unconsumed quote lookup. Live definition verified. No financial rows or Damilare statistics changed.

Changed `src/hooks/useDispatchOffers.ts`: missing/failed linked-order lookups fail closed; realtime inserts/updates re-run payment-filtered discovery rather than directly displaying offers. POS/assisted exceptions preserved.

Added `src/test/dispatch-offer-payment-gate.test.tsx` (seven tests) and test dependency `@testing-library/dom` in package.json/lockfile. Full suite: 83 tests passed. No edge functions changed/deployed. No manual typecheck or Deno check performed; app compilation is platform-managed.

Read-only production checks: quote lock installed; obsolete push address absent from live trigger. Last 30 days: zero paid online orders missing vendor share, zero delivered unpaid online orders, zero paid delivered orders with rider missing rider share, zero duplicate order/category/reference posting groups in checkout settlement categories. These checks are not a full fee-equation reconciliation.

Damilare canonical order remains paid/delivered with one each: customer debit 3760, vendor share 2360, platform commission 600, rider share 550, delivery commission 250 naira. Superseded order remains pending-payment/cancelled with no ledger rows. No repair ran.

## Unfinished — do not claim full atomicity

Creation and wallet payment remain separate calls. Server-checkout enforcement remains off. Still required: atomic validated checkout; durable intent/new-key reorder semantics; persistent rejection diagnostics; server-verifiable cart/pricing fingerprint; authoritative packaging/promotions/free-meal/options/pharmacy validation; safe older-client rollout; isolated actual-database concurrency/rollback tests; full reconciliation and final policy/RPC verification. These are unfinished engineering work, not external user-action blockers. WhatsApp-specific code was not modified.
