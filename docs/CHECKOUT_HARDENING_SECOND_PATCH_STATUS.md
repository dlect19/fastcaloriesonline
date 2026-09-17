# Second checkout hardening patch — partial

## September 17 follow-up: numeric pricing validation only

Applied `0024_validate_checkout_line_numeric_inputs.sql`: adds `validate_checkout_line_inputs(jsonb)` and invokes it from live `price_checkout_line(uuid,uuid,jsonb)`. Negative add-on quantities previously entered SUM(additional_price * quantity), allowing a reduced computed price. Rejects negative/zero/fractional/string/null add-on quantities, nonnumeric/nonpositive product quantities, malformed add-on arrays and unidentifiable entries. Name-based cached add-ons and omitted add-on quantity (default 1) remain supported. No historical row writes, repair, messages, configuration changes, or edge deployment.

Added `src/test/checkout-pricing-database.test.ts`, executing actual migrations 0021 and 0024 in in-memory PostgreSQL using test-only `@electric-sql/pglite`. Fixture tables and availability stub isolate pricing; this is NOT full checkout/concurrency/ledger integration coverage. Updated `src/test/setup.ts` to support Node tests. All 100 tests passed (17 new database tests). App build/typechecking remains platform-managed; no manual build/typecheck performed. No changed edge functions require Deno checking.

Read-only production verification confirmed the new pricing guard installed, quote row lock preserved, and `enforce_server_checkout=false`. Damilare rows and statistics were not written or recalculated; no new financial reconciliation was performed in this slice. Existing pricing still has option linkage/required-option, packaging, promotional and pharmacy gaps. No atomic checkout rollout occurred. This is a dependency-level safety patch, not completion of the requested phase.

Applied migration: `0023_lock_online_delivery_quote_consumption.sql` adds a row lock to the online integrity guard's unconsumed quote lookup. Live definition verified. No financial rows or Damilare statistics changed.

Changed `src/hooks/useDispatchOffers.ts`: missing/failed linked-order lookups fail closed; realtime inserts/updates re-run payment-filtered discovery rather than directly displaying offers. POS/assisted exceptions preserved.

Added `src/test/dispatch-offer-payment-gate.test.tsx` (seven tests) and test dependency `@testing-library/dom` in package.json/lockfile. Full suite: 83 tests passed. No edge functions changed/deployed. No manual typecheck or Deno check performed; app compilation is platform-managed.

Read-only production checks: quote lock installed; obsolete push address absent from live trigger. Last 30 days: zero paid online orders missing vendor share, zero delivered unpaid online orders, zero paid delivered orders with rider missing rider share, zero duplicate order/category/reference posting groups in checkout settlement categories. These checks are not a full fee-equation reconciliation.

Damilare canonical order remains paid/delivered with one each: customer debit 3760, vendor share 2360, platform commission 600, rider share 550, delivery commission 250 naira. Superseded order remains pending-payment/cancelled with no ledger rows. No repair ran.

## Unfinished — do not claim full atomicity

Creation and wallet payment remain separate calls. Server-checkout enforcement remains off. Still required: atomic validated checkout; durable intent/new-key reorder semantics; persistent rejection diagnostics; server-verifiable cart/pricing fingerprint; authoritative packaging/promotions/free-meal/options/pharmacy validation; safe older-client rollout; isolated actual-database concurrency/rollback tests; full reconciliation and final policy/RPC verification. These are unfinished engineering work, not external user-action blockers. WhatsApp-specific code was not modified.
