# Second canary order — read-only verification (FC-260917-4142)

Read-only queries only. Nothing was edited, paid, advanced, cancelled or refunded.

**Headline: the order is financially clean, but it again did NOT use the new server route — and this time it did not even use the new server order-creation function. The app that placed it is an older build.**

## Category results

**1. Rollout decision — FAIL.** `server_checkout_rollout_decisions` is still completely empty. A current app would have written a decision row (route "server", reason ALLOWLISTED) even on success. So the app never asked the server which route to use.

**2. Latest order — recorded, arithmetic correct.**
- FC-260917-4142, id 8f78a3fc-cd3e-4e24-bbe0-3ac1f988b610, 17 Sep 2026 09:23:00 UTC, channel online, Carryout, confirmed, paid by wallet.
- Vendor f88063f3…1dfc1, outlet 8bf0cd0f…a866a, environment production.
- Items 500 + service fee 100 + packaging 0 + extra package 0 + delivery 0 − discount 0 = **total 600**. PASS.
- checkout_attempt_key: empty. checkout_fingerprint: empty. delivery_quote_id: empty. payment_reference: `WP-BATCH-1789636984875`.

**3. Atomic route proof — FAIL.**
- The atomic route (`checkout_customer_wallet`) always pays with reference `WP-<order id>`; this order carries a **batched** `WP-BATCH-…` reference, which only the older wallet-payment edge function produces.
- The compatibility server route (`create_customer_order`) always stamps checkout_attempt_key and checkout_fingerprint onto the order; both are empty here.
- Therefore the order row was inserted **directly by the browser/app**, then paid through the old wallet-payment function. Neither new server function was involved. No mid-checkout fallback happened — no server route ever started.

**Root cause (evidence-based).** The current source already wires the rollout: `src/components/cart/VendorCheckoutSection.tsx` asks `get_server_checkout_rollout`, then calls `checkout_customer_wallet` when the route is "server". That code cannot produce an order with no attempt key and a `WP-BATCH` reference. The order therefore came from an **older client build** (published app / cached PWA / app shell not yet updated) that still inserts orders itself. Direct inserts are still permitted because the master switch `enforce_server_checkout` is deliberately `false`.

**4. Duplicates / idempotency — PASS.** Exactly 1 order for this customer in the ±5 minute window; no duplicate/superseded row; `checkout_integrity_events` empty (no replay, near-duplicate, stale-quote or pricing events).

**5. Wallet — PASS.** Customer wallet: one debit of 600.00, reference `WP-8f78a3fc…`, completed, balance after 192.00 (so 792.00 before, consistent with 292.00 after the earlier order plus a 500.00 top-up in between — see note below). No duplicate debit.

**6. Accounting — PASS.** Vendor share 450.00 credit, pending release, `VENDOR-SHARE-8f78a3fc…`; platform commission 150.00 completed, `PLATFORM-COMMISSION-8f78a3fc…`. 450 + 150 = 600 = the debit. No rider/delivery postings (carryout, no rider) — correct. Financial record: menu 500, vendor commission 10% = 50, service fee 100, company revenue 150, vendor payout 450. No duplicates, none missing.

**7. Items — PASS.** One line: Paracetamol 500mg, 1 sachet at 500.00 = 500.00, no add-ons; matches the 500 items subtotal.

**8. Quote handling — PASS.** A delivery quote was created 09:22:35 (fee 500, valid to 09:37) but the order is Carryout: delivery fee 0, no quote attached, quote still unconsumed. No delivery fee was improperly charged.

**9. Cart clearing — not verifiable.** Cart state is browser-side only; no server row to read.

**10. Rollout settings — PASS.** canary enabled true, exposure 0, allowlist exactly `0b6ec265-…f88ef` (the correct account), wallet true, external payments false, master enforcement false, minimum client version empty. The earlier allowlist correction is intact.

**Comparison with FC-260917-5039 (09:08).** Identical shape: same vendor/outlet, same 500/100/600 arithmetic, `WP-BATCH-…` reference, no attempt key. Both orders took the same old path; the allowlist fix changed nothing about which code the app ran, because the app itself is the older build.

*Note on the balance:* the 292.00 → 792.00 movement between the two orders comes from activity outside this order; I did not inspect or touch funding rows beyond what is listed above.

## Safest next action (nothing performed)

The canary cannot be exercised until the customer's app is running the current build. In order:

1. Have bamidlele place the test order from the **preview build** of the current code (or publish the current version and fully reload/reinstall the app so the cached shell is replaced).
2. Re-verify: a rollout decision row appears with route "server"/reason ALLOWLISTED, the order carries a checkout_attempt_key and fingerprint, and the payment reference is `WP-<order id>` with no `WP-BATCH`.
3. Only after that passes should any wider exposure be considered.

Optional follow-up to consider separately: an admin-visible warning when paid online orders arrive with no checkout_attempt_key, so old-client traffic is obvious without manual inspection.

No repair, settings change, or financial write was made.
