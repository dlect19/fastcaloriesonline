# Delivery canary audit — FC-260917-7258

Read-only queries only. Nothing was edited, paid, assigned, advanced, cancelled or refunded.

**Headline: the delivery order used the new hardened server route and every naira reconciles. One gap: the delivery-price service that issued the quote is running an older deployment, so the quote was not stamped with the cart fingerprint — that specific protection was not exercised.**

## Category results

**1. Rollout decision — PASS.** One row at 09:40:14 UTC: eligible true, route **server**, reason **ALLOWLISTED**, channel online, wallet, client version 1.2.0, cohort 52, attempt key `a9ece4cb-ca28-411b-bb5a-148aa9e3e43b`, no failure code.

**2. Order fields — PASS.**
- FC-260917-7258, id e3056afb-e3e6-4568-8ca6-30bc2809278f, created 09:40:13 UTC, delivered 09:52:18.
- Channel online, delivery, status delivered, paid by wallet, reference `WP-e3056afb-e3e6-4568-8ca6-30bc2809278f`, environment production.
- Vendor f88063f3…1dfc1, outlet 8bf0cd0f…a866a; address text "13/17 Don Fred Street, Idimu"; no saved address id (typed/GPS address); coordinates 6.5736318 / 3.2057443; distance 0 km; pricing source "proximity"; rider 56c79156…7bffe; prep 10 min.
- Money: items 500 + service fee 100 + packaging 0 + extra package 0 + delivery 500 − discount 0 = **total 1100**. PASS.

**3. Atomic route proof — PASS.**
- checkout_attempt_key present and identical to the rollout decision.
- checkout_fingerprint present and correct: user ~ vendor ~ outlet ~ delivery ~ 6.5736 ~ 3.2057 ~ (no promo) ~ item `4a174518…:1:sachet`.
- Payment reference exactly `WP-<order id>`; **no `WP-BATCH`** anywhere. One decision row, no failure code — no fallback.

**4. Duplicates / idempotency — PASS.** Exactly 1 order carries this attempt key. Two orders exist in the ±5 minute window, but the other is the earlier carryout FC-260917-6550 (09:35:20) with its own distinct key — a legitimate separate checkout, not a duplicate. No duplicate debit or posting. `checkout_integrity_events` empty — no replay, near-duplicate, stale-quote or pricing events.

**5. Wallet — PASS.** One debit of ₦1,100.00, completed, `WP-e3056afb…`, balance after **192.00** (so 1,292.00 before). Exactly one debit.

**6. Items — PASS.** One line: Paracetamol 500mg, quantity 1, sachet, unit 500.00, total 500.00, no add-ons. 500 + 100 + 0 + 0 + 500 − 0 = 1,100 ✓.

**7. Delivery quote — PARTIAL.**
- PASS: quote 392f8277…f24c belongs to the correct customer, vendor and outlet; destination coordinates match the order exactly (6.5736318 / 3.2057443); issued 09:39:57, expiring 09:54:57, so **unexpired** at 09:40:13 checkout; delivery fee 500 = order delivery fee; consumed exactly once, `consumed_order_id` set to this order (the concurrency-safe consume marker); not stale, altered or reused. Pricing detail: source proximity, distance 0 km, base fee 500, surge 0, per-km 350, base distance 1 km, morning/clear, no fallback used. Only 1 of the 4 quotes issued to this customer today is consumed — the others simply expired unused.
- **FAIL on binding:** the quote row's `checkout_fingerprint` and `delivery_type` are **empty**. The current source of the delivery-price service does write both, so the **deployed version is older than the code**. Because the server only compares fingerprints when the quote carries one, the cart-binding check was skipped for this order. Fee correctness was still fully server-side, so no money is wrong — but "a changed cart cannot reuse a quote" was not actually proven here.

**8. Delivery accounting — PASS.**
- Vendor share ₦450.00 credit, pending release 23:00 UTC, `VENDOR-SHARE-e3056afb…`.
- Platform commission ₦150.00 completed, `PLATFORM-COMMISSION-e3056afb…` (₦50 vendor commission at 10% + ₦100 service fee).
- Rider share ₦250.00 completed at 09:51:09, `RIDER-SHARE-e3056afb…`; platform delivery commission ₦250.00 completed, `PLATFORM-DELIVERY-e3056afb…`. Posted on rider assignment, not at checkout — as designed; 250 + 250 = the ₦500 delivery fee.
- Totals: customer paid 1,100 = 450 vendor + 150 platform + 250 rider + 250 platform delivery. Financial record agrees (menu 500, vendor commission 10%/50, service fee 100, company revenue 150, rider commission 50%/250, vendor payout 450). No missing or duplicate rows.

**9. Unpaid-fulfilment guard — PASS.** Payment completed 09:40:13; the dispatch request was created 09:50:58 and accepted, rider credited 09:51:09, delivered 09:52:18 — every fulfilment step happened after payment. Exactly one dispatch request, no offers to a rider on an unpaid order.

**10. Canary settings — PASS (unchanged).** enabled true, exposure 0%, allowlist exactly `0b6ec265-…f88ef`, wallet true, external payments false, master enforcement false, minimum client version empty.

**Route comparison with FC-260917-6550 (carryout, proven).** Identical markers: decision row route server/ALLOWLISTED, attempt key matching the decision, fingerprint present, `WP-<order id>` reference, no `WP-BATCH`. This order additionally exercised the delivery-quote path.

## Safest next action (nothing performed)

1. Redeploy the delivery-price service so newly issued quotes are stamped with the cart fingerprint and fulfilment type (the code is already correct; only the deployed copy is behind).
2. Then place one more delivery test and confirm the new quote row carries a fingerprint matching the order, so the cart-binding rejection path is genuinely proven.
3. Only after that, consider a small percentage exposure. Card/bank/transfer stays off until wired and verified separately.

No repair, settings change, redeploy, or financial write was made in this audit.
