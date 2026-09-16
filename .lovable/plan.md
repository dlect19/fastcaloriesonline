# Hardening audit (read-only) — customer ordering, payment, fulfilment, accounting

No code, migrations, rows, payments or messages were touched. WhatsApp out of scope.

## Verdict per area

| # | Area | Verdict |
|---|------|---------|
| 1 | Checkout idempotency / duplicate prevention | PARTIAL |
| 2 | Payment integrity (wallet + Paystack) | **FAIL** (two critical holes) |
| 3 | Delivery pricing / carryout exploit | PASS (one gap: amount not bound) |
| 4 | Fulfilment gating | PARTIAL |
| 5 | Settlement / accounting | PASS |
| 6 | Damilare post-repair | PASS |
| 7 | Push / realtime / background jobs | PARTIAL (stale URL confirmed) |
| 8 | Security / concurrency | **FAIL** (client can write money fields) |
| 9 | Safe test matrix | PARTIAL (helpers, not triggers) |

## Critical findings (evidence)

**C1 — Any signed-in customer can mark their own order paid from the browser.**
`orders` RLS policy `Involved parties can update orders` is `FOR UPDATE` with `USING (auth.uid() = user_id OR owns_vendor(...) OR auth.uid() = rider_id)` and **no WITH CHECK**, and `has_column_privilege('authenticated','orders','payment_status','UPDATE')` = true (same for `total`, `delivery_fee`, `payment_method`). Setting `payment_status='paid'` fires `trigger_credit_vendor_on_payment` → `credit_vendor_on_payment()` → real vendor credit + platform commission with **no wallet debit**. Free orders and minted money. Setting `payment_method='cash'` also short-circuits `guard_unpaid_order_fulfilment()` (its first checks exempt `cash`).

**C2 — Order money amounts are still client-supplied.**
`src/components/cart/VendorCheckoutSection.tsx:531` inserts the `orders` row from the browser with `menu_subtotal`, `subtotal`, `total`, `service_fee`, `discount`. `enforce_checkout_integrity()` is `BEFORE INSERT` only and validates the **delivery fee against the issued quote**, nothing else. `supabase/functions/process-wallet-payment/index.ts` debits `Number(order.total)` (line 151) and only calls `validateOrderPricing` (delivery fee). No recompute of items × prices, add-ons, portions, packs, service fee or promo. A crafted total is charged as-is.

## 1) Checkout idempotency — PARTIAL
- Client-generated key `checkout_attempt_key` (`src/lib/checkoutIntegrity.ts:resolveAttemptKey`, `VendorCheckoutSection.tsx`), unique partial index + replay rejection and a 120 s identical-order guard in `enforce_checkout_integrity()` (migration `0017_checkout_integrity_and_delivery_quotes.sql`). `DUPLICATE_CHECKOUT:<id>` resume path works.
- Gaps: key is client-generated, so a **page reload before success mints a new key** — only the 120 s same-user/vendor/outlet/type/total guard then stands; that guard is also the false-positive risk for a deliberate identical re-order inside 2 minutes (no override path). Concurrency is safe (unique index + serialized trigger).
- DB evidence: 30-day scan for same user + vendor + total within 3 min returns **only the known Damilare pair**.

## 2) Payment integrity — FAIL
- Paystack webhook `supabase/functions/paystack-webhook/index.ts` does verify `x-paystack-signature` (HMAC-SHA512), amount in kobo, order binding, ignores `cancelled` orders, and ledger writes go through the idempotent `post_wallet_entry(p_reference)` — duplicate webhooks are safe. PASS in isolation.
- `process-wallet-payment` sets `payment_status='paid'` **before** posting the ledger entry and manually reverts on failure (lines 159 / 195): not one transaction; a failed revert leaves a paid order with no debit.
- Everything above is moot while C1 stands.

## 3) Delivery pricing — PASS with one gap
- `quote-delivery-fee` persists `delivery_quotes` with 15-min TTL and returns `quoteId`; `enforce_checkout_integrity()` requires a live, unconsumed, same-user/same-outlet/coordinate-matching quote and overwrites the fee with the authoritative value; carryout clears fee + quote; `quoteSurvivesChange` (`src/lib/checkoutIntegrity.ts`) drops the quote on carryout, address or branch change, forcing a fresh server quote. Fallback/base fee comes from server settings in `_shared/delivery-pricing.ts`.
- Gap: the quote is not bound to the checkout attempt key or cart amount, so one quote could be replayed across unrelated carts (same outlet/address) until consumed.

## 4) Fulfilment gating — PARTIAL
- `guard_unpaid_order_fulfilment()` (BEFORE UPDATE) blocks rider assignment and every forward status on unpaid online/whatsapp orders; `dispatch-order` filters `payment_status='paid'`; `VendorOrders.tsx` hides unpaid non-POS orders.
- Gaps: `RiderAvailableOrders.tsx` has no paid-only filter (relies on the trigger); `cash` payment_method is a client-writable exemption (see C1); POS/assisted correctly exempt.
- DB: delivered unpaid online orders in 30 days = **0**; unpaid orders with positive postings = **0**.

## 5) Settlement — PASS
- Deterministic references: `VENDOR-SHARE-<id>`, `PLATFORM-COMMISSION-<id>`, `RIDER-SHARE-<id>`, `PLATFORM-DELIVERY-<id>`, `WP-…`; `post_wallet_entry` is idempotent per wallet+reference. Duplicate postings per order/category/reference in 30 days = **0**. Delivered delivery orders with a rider missing `rider_share` = **0**.
- 7 paid orders missing `vendor_share` — all `channel='pos'` (cash at counter, no ledger posting by design). Not a defect.

## 6) Damilare — PASS
`FC-260916-2651` (paid, delivered, rider set) carries exactly: customer debit ₦3,760 ×1, `vendor_share` ₦2,360 ×1, `platform_commission` ₦600 ×1, `rider_share` ₦550 ×1, `delivery_commission` ₦250 ×1. `FC-260916-7675` is `cancelled` with `duplicate_of_order_id` set, zero ledger rows, no refund or reversal.

## 7) Push / jobs — PARTIAL
`trigger_order_push_notification()` still contains the dead project URL `https://bruyccrjymmpzulqhotw.supabase.co` (confirmed in `pg_get_functiondef`). It is `AFTER UPDATE`, so a failing `net.http_post` is asynchronous and cannot roll back an order — no duplication risk, but every order update silently fails to notify through that path.

## 8) Security / concurrency — FAIL
- C1 above. All 191 public functions are `SET search_path` clean; no SECURITY DEFINER without search_path.
- `Riders can claim unassigned orders` is also `USING`-only with no `WITH CHECK`, so a rider row update is column-unrestricted too.
- Races checked: two checkouts (safe), two webhooks (safe), two completions (safe via reference idempotency), vendor+admin concurrent status change (last write wins, no financial double-post).

## 9) Tests — PARTIAL
`src/test/checkout-integrity.test.ts` (22 cases) exercises the shared helpers that mirror the triggers, not the triggers themselves; `order-tracking.test.ts`, `product-ordering-rules.test.ts` likewise. No test covers duplicate/late Paystack webhooks, wallet-debit rollback, or client-side field tampering.

## Prioritized remediation (not implemented)

1. **P0** Revoke column-level UPDATE from `anon`/`authenticated` on the money/state columns of `orders` (`payment_status`, `payment_reference`, `payment_method`, `total`, `subtotal`, `menu_subtotal`, `delivery_fee`, `service_fee`, `discount`, `rider_id`, `status`), or add a BEFORE UPDATE trigger rejecting non-service-role changes to them; add `WITH CHECK` to both UPDATE policies.
2. **P0** Move order creation server-side (RPC/edge function) that recomputes subtotal/total from products, portions, add-ons, packs, service fee and promo, and rejects client figures — or at minimum add a server recompute gate inside `process-wallet-payment` and the Paystack init path.
3. **P1** Make wallet payment one transaction (post the ledger entry and flip `payment_status` in the same RPC).
4. **P1** Server-issue the checkout attempt key (bind it to cart hash) and bind `delivery_quotes` to that key + expected amount.
5. **P2** Add paid-only filter to `RiderAvailableOrders.tsx`; remove the client-writable `cash` exemption in favour of a vendor/admin-set flag.
6. **P2** Repoint or drop `trigger_order_push_notification()`'s stale URL.
7. **P3** Tests: duplicate + late Paystack webhook, wallet rollback, tampered-field rejection, integration tests running against the real triggers.
