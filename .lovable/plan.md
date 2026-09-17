# Final canary verification — FC-260917-6550: PASS

Read-only queries only. Nothing was edited, paid, advanced, cancelled or refunded.

**Headline: this order went through the new hardened checkout end to end. Every category passes.**

## Category results

**1. Rollout decision — PASS.** One decision row at 09:35:21 UTC: eligible **true**, route **server**, reason **ALLOWLISTED**, channel online, payment wallet, client version 1.2.0, cohort 52, attempt key `4233d77d-a15b-4428-a48d-208c8059b1e2`, user 0b6ec265-…f88ef. No failure code.

**2. Order fields — PASS.**
- FC-260917-6550, id b7bfa077-828a-4607-9f7f-2a4d4d0df3df, created 17 Sep 2026 09:35:20 UTC.
- Channel online, Carryout (delivery pricing source "carryout"), status confirmed, paid by wallet, reference `WP-b7bfa077-828a-4607-9f7f-2a4d4d0df3df`, environment production.
- Vendor f88063f3…1dfc1, outlet 8bf0cd0f…a866a (Dlect pharmacy – Alimosho), pharmacy review not required.
- Money: items 500 + service fee 100 + packaging 0 + extra package 0 + delivery 0 − discount 0 = **total 600**.

**3. Atomic route proof — PASS.**
- checkout_attempt_key present and identical to the rollout decision's key.
- checkout_fingerprint present and correctly composed: user ~ vendor ~ outlet ~ self_pickup ~ (no coordinates) ~ (no promo) ~ item `4a174518…:1:sachet`.
- Payment reference is exactly `WP-<order id>`, the form only the atomic route produces. **No `WP-BATCH` reference anywhere**, so the old compatibility wallet-payment function was not involved.
- No fallback: a single decision row with route "server" and no failure code, and one order.

**4. Duplicates / idempotency — PASS.** Exactly 1 order for this customer in the ±5 minute window, and exactly 1 order bearing this attempt key. No duplicate/superseded row. `checkout_integrity_events` empty — no replay, near-duplicate, stale-quote or pricing-mismatch events.

**5. Wallet — PASS.** One debit of ₦600.00, completed, reference `WP-b7bfa077…`, balance after **92.00** (so 692.00 before). Exactly one debit; no duplicate.

**6. Accounting — PASS.** Vendor share ₦450.00 credit, pending release, `VENDOR-SHARE-b7bfa077…`; platform commission ₦150.00 completed, `PLATFORM-COMMISSION-b7bfa077…`. 450 + 150 = 600 = customer debit. No rider or delivery postings — correct for carryout with no rider. Financial record: menu 500, vendor commission 10% = 50, service fee 100, company revenue 150, vendor payout 450. Nothing missing, nothing duplicated.

**7. Items — PASS.** One line: Paracetamol 500mg, quantity 1, sachet, unit 500.00, line total 500.00, no add-ons. Matches the 500 items subtotal and therefore the 600 total.

**8. Quote handling — PASS.** Carryout: delivery fee 0, no delivery quote attached, pricing source recorded as carryout. No delivery fee charged and no quote consumed.

**9. Live canary settings — PASS (unchanged).** canary enabled true, exposure 0%, allowlist exactly `0b6ec265-6…f88ef`, wallet true, external payments false, master enforcement false, minimum client version empty.

**10. Route comparison with FC-260917-4142 — PASS.**

| Marker | FC-260917-4142 (old build) | FC-260917-6550 (this order) |
| --- | --- | --- |
| Rollout decision row | none | route server / ALLOWLISTED |
| checkout_attempt_key | empty | 4233d77d-… |
| checkout_fingerprint | empty | present |
| Payment reference | `WP-BATCH-1789636984875` | `WP-b7bfa077-…` |

Same cart and totals, different path — this one used the hardened server route.

## Next step

The canary is proven for wallet carryout on the published build. Reasonable follow-ups, none performed:
1. Repeat once with a **delivery** order so quote binding and the delivery fee path are exercised on the server route.
2. Then consider a small percentage exposure (for example 5%) while watching the rollout decisions and integrity tables.
3. Card/bank/transfer remains off and untested; leave it off until wired and verified separately.

No repair, settings change, or financial write was made.
