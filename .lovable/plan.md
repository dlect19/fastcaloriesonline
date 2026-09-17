# Canary checkout verification — read-only findings

Verified with read-only database queries only. Nothing was edited, paid, advanced, cancelled or refunded.

**Headline: the order is financially clean, but it did NOT go through the new canary checkout.** The allowlist holds the customer's *profile* id, while the eligibility check matches the *account* id, so this customer was never actually eligible and the order took the old checkout route.

## Evidence

**Order (FC-260917-5039)**
- id 1ded7173-1b26-47d1-8d2b-533b086f0de1, created 17 Sep 2026 09:08:05 UTC, channel online, status confirmed, payment paid (wallet), fulfilment Carryout, vendor f88063f3…1dfc1, outlet 8bf0cd0f…a866a, environment production.
- Money: items 500 + service fee 100 + packaging 0 + extra package 0 + delivery 0 − discount 0 = **total 600**. PASS.
- checkout_attempt_key: empty. checkout_fingerprint: empty. delivery_quote_id: empty.

**1. Rollout decision — FAIL (no record)**
No rollout decision rows exist at all. Combined with the payment reference below, the checkout ran on the old (compatibility) route, not the new server route.

**Route used — FAIL (not the atomic route)**
The order's payment reference is `WP-BATCH-1789636090831`, the batched form produced by the older wallet-payment function. The new atomic route always uses `WP-<order id>` as its reference. The wallet entry confirms `source: pay_orders_with_wallet`, batch `WP-BATCH-…`. There is no evidence of a fallback *after* starting the server route — the server route never started.

**Root cause — the allowlisted id is the wrong id**
- Allowlist contains `665226bc-6678-4c06-8acc-4d4616a6f5ef` — that is bamidlele's **profile row id**.
- The customer's **account id** (what eligibility compares against) is `0b6ec265-bf3f-48d0-b52f-8f0202ef88ef`, which owns this order and the wallet that was debited.
- So eligibility returned "not allowlisted", exposure is 0%, and the customer stayed on the old path.

**2. Duplicate check — PASS.** Exactly 1 order for this customer in the ±5 minute window. One canonical order, no duplicate/superseded rows.

**3. Wallet — PASS.** Customer wallet 0c76b424…: balance after 292.00, so before 892.00. Exactly one debit of 600.00 (`WP-1ded7173…`), completed, no second debit; 3 ledger rows total for the order.

**4. Accounting — PASS.** Vendor share 450.00 credit, pending, released 17 Sep 23:00 UTC, reference `VENDOR-SHARE-1ded7173…`. Platform commission 150.00 completed, reference `PLATFORM-COMMISSION-1ded7173…`. 450 + 150 = 600 = customer debit. No rider/delivery postings (carryout, no rider) — correct. No duplicates or missing postings. Financial record: menu 500, vendor commission 10% = 50, service fee 100, company revenue 150, vendor payout 450 — consistent.

**5. Items — PASS.** One line: Paracetamol 500mg, 1 sachet at 500.00 = 500.00, no add-ons; matches the 500 items subtotal.

**6. Delivery quote — PASS.** A quote was created 09:07:40 (fee 500, expiring 09:22) but the order is Carryout: delivery fee 0, no quote attached, and the quote is still unconsumed. No delivery fee was improperly charged.

**7. Integrity events — PASS (none).** No rejection, mismatch, or fallback events recorded for this attempt.

**8. Cart clearing — not verifiable.** Cart state lives in the browser; no server row to read without mutation.

**9. Live canary settings — PASS on switches, FAIL on allowlist content.** enabled true, exposure 0, wallet true, external payments false, master enforcement false, minimum client version empty, allowlist exactly one id — but that one id is the profile id, not the account id.

## Safest next action (not performed)

Correct the allowlist through the authorized admin rollout control so it contains exactly the account id `0b6ec265-bf3f-48d0-b52f-8f0202ef88ef` (replacing the profile id), leaving exposure at 0%, wallet on, external payments off and master enforcement off. Then have the same customer place one small carryout wallet order again and re-verify that a rollout decision row appears with route "server" and the payment reference is `WP-<order id>`.

Optional hardening to consider separately: have the admin control reject ids that are not real account ids, so this mix-up cannot recur.

No repair, settings change, or financial write was made.
