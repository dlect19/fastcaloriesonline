# Final canary audit — delivery order FC-260917-2641: PASS on every category

Read-only queries only. Nothing was edited, paid, assigned, advanced, cancelled or refunded.

**Headline: the gap found in the previous delivery order is closed. The delivery price was bound to this exact cart, and the checkout guard compared them.**

## Category results

**1. Rollout decision — PASS.** One row at 10:13:37 UTC: eligible true, route **server**, reason **ALLOWLISTED**, online, wallet, client version 1.2.0, cohort 52, attempt key `8b6c209c-eed3-46f6-9242-19c4ced5b777` — the same key stored on the order.

**2. Atomic server route — PASS.** Attempt key and cart reference both present on the order; payment reference exactly `WP-e75178ff-ee12-42d6-977c-59e5497732b1`; **no `WP-BATCH`**; one decision row, no failure code, so no fallback.
- FC-260917-2641, id e75178ff-ee12-42d6-977c-59e5497732b1, created 10:13:36 UTC, delivered 10:16:28; online, delivery, paid by wallet, production; vendor f88063f3…1dfc1, outlet 8bf0cd0f…a866a; address "13/17 Don Fred Street, Idimu", coordinates 6.5736318 / 3.2057443; rider 56c79156…7bffe.

**3. One canonical order — PASS.** Exactly 1 order in the ±5 minute window, exactly 1 order carrying this attempt key, no duplicate/superseded row, no duplicate debit or posting. `checkout_integrity_events` empty.

**4. Wallet and accounting — PASS.**
- One debit ₦1,100.00, completed, `WP-e75178ff…`, balance after 1,092.00 (2,192.00 before).
- Vendor share ₦450.00 pending release 23:00 UTC, `VENDOR-SHARE-…`; platform commission ₦150.00 completed, `PLATFORM-COMMISSION-…` (₦50 vendor commission at 10% + ₦100 service fee).
- On rider assignment (10:15:27): rider share ₦250.00, `RIDER-SHARE-…`; platform delivery commission ₦250.00, `PLATFORM-DELIVERY-…`. 250 + 250 = the ₦500 delivery fee.
- 450 + 150 + 250 + 250 = 1,100 = the customer debit. Financial record agrees (menu 500, service fee 100, company revenue 150, rider 50%/250, vendor payout 450). Nothing missing, nothing duplicated.

**5. Items and totals — PASS.** One line: Paracetamol 500mg, 1 sachet, unit 500.00, total 500.00, no add-ons. 500 items + 100 service + 0 packaging + 0 extra package + 500 delivery − 0 discount = **1,100** ✓.

**6. Delivery quote — PASS (binding now present).**
- Quote 03c13b81-5be8-42e6-82d2-5e26cdcd6051, correct customer, vendor and outlet; destination 6.5736318 / 3.2057443 identical to the order; no saved address id (typed/GPS address, matching the order).
- `delivery_type` stored as **delivery** (was empty on the previous order).
- `checkout_fingerprint` is **present and byte-for-byte identical** to the order's own cart reference: `0b6ec265…~f88063f3…~8bf0cd0f…~delivery~6.5736~3.2057~~4a174518…:1:sachet::`. No format difference at all, so no interpretation is needed.
- Issued 10:12:45, expiring 10:27:45 → **unexpired** at the 10:13:36 checkout.
- Quote fee 500 = order delivery fee 500. Consumed exactly once, `consumed_order_id` = this order, and exactly one quote is consumed by it. No stale, mismatched, reused or fallback pricing.
- Pricing detail: source proximity, distance 0 km, base fee 500, surge 0, per-km 350, base distance 1 km, morning/clear, no fallback attempts.

**How the guard actually compared them.** The server checkout rejects a delivery order unless a quote exists for the same customer and vendor that is unconsumed and unexpired (`DELIVERY_QUOTE_STALE` otherwise), and then — when the quote carries a cart reference — rejects it if that reference differs from the checkout's own (`DELIVERY_QUOTE_CHECKOUT_MISMATCH`). Here the quote carried a reference and it matched, so the comparison genuinely ran and passed. On the previous order the quote's reference was empty, so that comparison was skipped — that is the difference this test proves.

**7. Paid before fulfilment — PASS.** Paid 10:13:36; the dispatch request was created 10:15:11 and accepted, rider credited 10:15:27, delivered 10:16:28. Every fulfilment step followed payment; exactly one dispatch request.

**8. Canary settings — PASS (unchanged).** enabled true, exposure 0%, allowlist exactly `0b6ec265-…f88ef`, wallet true, external payments false, master enforcement false, minimum client version empty.

**9. Comparison with FC-260917-7258.**

| Marker | FC-260917-7258 | FC-260917-2641 |
| --- | --- | --- |
| Route / decision row | server, ALLOWLISTED | server, ALLOWLISTED |
| Payment reference | `WP-<order id>` | `WP-<order id>` |
| Quote fulfilment type | empty | delivery |
| Quote cart reference | empty | present, matches the order |
| Cart-binding comparison | skipped | ran and passed |

## Next step

The wallet checkout path is now proven end to end for both carryout and delivery, including quote binding. Reasonable next moves, none performed:
1. Optionally prove the rejection side once (for example request a price, change the cart, then check out) so a `DELIVERY_QUOTE_CHECKOUT_MISMATCH` is observed rather than only inferred.
2. Then consider a small percentage exposure (e.g. 5%) while watching the rollout decisions and integrity tables.
3. Card/bank/transfer stays off until that path is wired to the server route and verified separately.

No repair, settings change, or financial write was made.
