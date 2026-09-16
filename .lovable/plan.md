# Order integrity, delivery pricing and settlement repair

## What the audit found (read-only, production)

**The duplicate is real and it is the only one of its kind in 90 days.**

| | Paid order | Duplicate |
|---|---|---|
| Number | FC-260916-2651 | FC-260916-7675 |
| Created | 16:48:49 | 16:48:51 |
| Total | 3,760 | 3,760 |
| Payment | paid (wallet ref present) | pending, no reference |
| Status | preparing, no rider | delivered, rider assigned |

A 90-day scan for same customer + same store + same amount within 3 minutes returned only three other pairs, all from one internal test account, all paid and all cancelled — no money is at risk there. No other bypass pattern surfaced.

**Root cause of the duplicate.** The order row is created by the browser itself (`src/components/cart/VendorCheckoutSection.tsx`), in several separate steps, with nothing that identifies one checkout attempt: no server-issued attempt key, no unique constraint, no single atomic server call. Any repeat of that flow — second tap, network retry, reload, a second tab — inserts a whole second order. The wallet charge is a separate call made afterwards, which is why the second order was never paid.

**Root cause of the unpaid order being delivered.** Nothing on the fulfilment side checks payment. Rider assignment and completion have no payment condition, and the vendor order list only hides unpaid orders for assisted orders — so an unpaid online order is fully workable, and the rider settlement trigger then refuses to pay the rider because payment is pending. That is the missing rider earning.

**Rider settlement formula (from production, not invented).** The platform already computed this delivery: rider 550, platform delivery commission 250, on the 800 delivery fee. Those figures are stored against the duplicate order and are what the normal settlement path would use.

## Damilare repair (single transactional, idempotent step)

Treats the paid order as the financial source of truth. No customer charge, no refund, no vendor or platform re-credit.

1. Copy the stored delivery/payout facts (rider pay 550, platform fee 250, distance) onto the paid order.
2. Move the operational facts across: rider, pickup/delivery timestamps, delivered status onto the paid order.
3. Let the platform's own settlement trigger fire from that assignment, so the rider is credited 550 and platform delivery commission 250 with the standard references keyed to the paid order — the same mechanism, references and categories a normal completed delivery uses, so it can never double-pay.
4. Mark the second order as `duplicate_superseded` with a pointer to the paid order — explicitly not a customer cancellation, so no reversal or refund logic runs.
5. Read back and report: rider wallet balance, total earned, the new transaction row and reference, vendor pending release, platform postings, customer debit.

Notification suppression: the status-change trigger posts to the notification function. The repair sets a suppression flag that the trigger will honour, so the repair sends no push, WhatsApp or SMS.

## Preventing recurrence

**One checkout, one order.** A server-issued checkout attempt key stored on the order with a unique index, plus a new atomic checkout function that creates the order, its items and the wallet debit as one unit and returns the *existing* order when the same key is replayed. The browser stops inserting orders. A short-window guard catches an identical repeat that arrives without a key; a deliberate reorder later uses a fresh key and is unaffected.

**No fulfilment of unpaid online orders.** A database guard refuses rider assignment or delivered/completed status on an unpaid non-COD online order, and the vendor and rider queues stop showing them.

**Delivery fee cannot be bypassed.** Delivery quotes get issued and stored server-side, bound to customer, store/branch, address, coordinates, cart amount and an expiry. Switching to carryout invalidates the quote; switching back, or changing address, branch or cart, requires a fresh one. Checkout rejects a delivery order without a valid unexpired quote and always uses the quoted fee — the client's fee, distance and total are never trusted. Existing distance, weather, surge and fallback pricing behaviour is unchanged, and the base/fallback fee can no longer be silently dropped.

**Settlement idempotency** stays reference-based and is extended so a repeated completion cannot mint money.

## Visibility

An admin diagnostics view listing duplicate checkout attempts (blocked replays and short-window repeats) and rejected stale or invalid delivery quotes, with no secrets or tokens shown.

## Tests

Rapid double tap; two concurrent requests with the same attempt key; retry after a timed-out response; the same cart reordered later with a new key; delivery → carryout → delivery needing a new quote; expired quote rejected; tampered client delivery fee ignored; unpaid wallet order refused for dispatch and completion; rider settled exactly once; a repeated completion creating no extra money. All run against test fixtures — no real orders, payments, rider assignments or messages.

## Technical notes

- Additive migrations only: `orders.checkout_attempt_key` (unique), `orders.duplicate_of_order_id`, quote table + expiry, guard triggers, atomic checkout RPC, notification suppression flag honoured by `trigger_order_push_notification`, admin diagnostics view.
- Repair runs as one transactional statement set through the data tool, reusing `credit_rider_on_assignment` rather than hand-posting ledger rows.
- Files: `src/components/cart/VendorCheckoutSection.tsx`, `src/hooks/useDeliveryFee.ts`, `supabase/functions/quote-delivery-fee`, `process-wallet-payment`, `_shared/validate-order-pricing.ts`, vendor/rider order queues, plus new tests.
- Assumption: no COD exists for online wallet checkout, so unpaid online orders must never be fulfillable. Say so now if any store is intentionally cash-on-delivery.
- Unresolved risk: the delivery quote binding changes touch every ordering surface (web, assisted, POS, WhatsApp). WhatsApp already prices via the server quote; assisted and POS paths will be adjusted to request quotes rather than being blocked mid-order.
