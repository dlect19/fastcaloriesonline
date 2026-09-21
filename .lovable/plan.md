# WhatsApp post-order fee breakdown ("what did I pay for?")

## What happens today

When an order is placed the WhatsApp cart is cleared (`clearCartAfterOrder`), and the assistant has no tool that can read money details back out of a placed order — so it truthfully says it has no record. This is a missing tool, not missing data.

The order itself is stored permanently and immutably:

- `orders`: `menu_subtotal`, `packaging_fee`, `delivery_fee`, `service_fee`, `discount`, `promo_code`, `subtotal`, `total`, `total_calories`, `delivery_type`, `delivery_distance_km`, `delivery_pricing_source`, `delivery_pricing_meta`, `payment_method`, `payment_status`, `payment_reference`, `confirmation_code`, `created_at`, `channel`.
- `order_items`: product name, quantity, `unit_price`, `total_price`, portion, calories, plus refund/substitution fields.
- `order_item_addons`: add-on group/item name, `additional_price`, calories.
- `whatsapp_checkouts.pricing_snapshot` / `cart_snapshot`: the exact confirmed quote for WhatsApp orders, including the service-fee split.

Two real gaps:

1. `orders.service_fee` is one combined number. The split (platform service fee vs WhatsApp communications/AI fee vs status-message allowance) exists only in `whatsapp_checkouts.pricing_snapshot` and `whatsapp_cost_quotes`, not on the order.
2. There is no tax or tip column anywhere, and payment-processor charges are absorbed — so a receipt must not invent those lines.

## What to build

### 1. Immutable fee breakdown on the order (additive migration)

Add `orders.fee_breakdown jsonb` (nullable, no default change to existing rows). At WhatsApp checkout, write the already-frozen components into it: menu subtotal, packaging, delivery, platform service fee, WhatsApp communications fee, status-message allowance, discount, promo code, total, payment method. Nothing is recomputed later — the receipt reads only stored values.

No backfill of past orders. For orders created before this change, the receipt resolves the split from `whatsapp_checkouts.pricing_snapshot` when one exists for that order id; otherwise it reports the combined service fee as a single "Service & fees" line and says the finer split was not recorded for that order. No estimated or reconstructed figures.

### 2. `get_my_order_receipt` assistant tool

- Scoped strictly to `ctx.userId` (the verified WhatsApp-linked customer). No phone-only lookup, no admin scope, unauthenticated calls return the existing auth-required result.
- Accepts `order_number` (leading `#` stripped) or `order_id`; with neither, it uses that customer's most recent order and states which order number it is answering about, so "latest" is never ambiguous.
- Works for completed, cancelled and historical orders, and for app/web orders too (same ownership rule).
- Returns: order number, date, branch name, fulfilment type, per-line items (name, portion, qty, unit price, line total, add-ons with prices), discount/promo, delivery fee with distance when present, service/fee lines from the stored breakdown, total, payment method, payment status, and refunded/substituted markers where the row says so.
- Wallet top-ups are never included — only rows in `orders`. Paid-by-wallet is reported as a payment method, not as a top-up.
- Money formatted through the existing `money()` helper; naira, integer kobo-safe rounding identical to checkout.

### 3. Automatic receipt message

After a successful wallet order (already paid) and after verified Paystack confirmation, send the same breakdown once, from the stored order, using the existing idempotent notification claim so a retry or replayed webhook cannot send it twice. On-demand requests go through the tool.

### 4. Retention / audit

No new retention surface: the receipt is a read of existing rows. Admin already sees full financials via `order_financials` and the checkout-integrity pages; the tool adds no admin-visible writes beyond existing tool-call logging (which records no customer text).

## Risks handled

- **No recalculation with current prices** — receipts read snapshots only; `reorder` remains the only path that re-prices.
- **Cross-customer exposure** — ownership filter on `user_id` plus existing RLS; an order number belonging to someone else returns "not found".
- **Ambiguous latest order** — the reply always names the order number.
- **Rounding/currency** — no arithmetic beyond summing stored line values for display; the stored total is authoritative and shown as stored.
- **Communications/status fees** — shown only when recorded for that order; billing stays in shadow mode, so these currently read ₦0 and must not be presented as charged.

## Untouched

Atomic checkout, `enforce_server_checkout`, outlet binding (no guessing), strict Paystack verification, payment-proof non-authority, launch/canary gate, cost gating, wallet ledger.

## Files and tables

- `supabase/functions/whatsapp-webhook/tools.ts` — new tool definition + handler, breakdown written at checkout, receipt sent after wallet order.
- `supabase/functions/whatsapp-webhook/index.ts` (or the existing payment-confirmation path) — receipt after verified payment.
- New migration adding `orders.fee_breakdown jsonb`.
- Reads: `orders`, `order_items`, `order_item_addons`, `whatsapp_checkouts`, `vendors`/`vendor_outlets` for the branch name.

## Tests (mock-only, no live calls)

- Owner gets an itemized receipt whose lines and total match the stored order exactly.
- Another customer's order number returns not-found; unauthenticated returns auth-required.
- Historical order with no `fee_breakdown` falls back to `pricing_snapshot`; with neither, one combined fee line and an honest "not recorded" note.
- No order number given → latest order, order number stated.
- Receipt figures never change when product prices change afterwards.
- Wallet top-up rows never appear in a receipt.
- Automatic receipt sends exactly once on replay of the same order/webhook.
