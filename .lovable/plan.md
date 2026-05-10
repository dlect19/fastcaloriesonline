# Admin: Separate POS Orders + On-Hold Payments Review

## 1. Split Orders Page (POS vs Online)

In **Admin → Orders**, add a tab switcher at the top of the existing Orders table:

- **Online Orders** — current default view (Delivery + Carryout web/app orders)
- **POS Orders** — only orders where `order_type = 'pos'` (in-store sales rung up via `/vendor/pos`)

Each tab shows the **same column layout** already in use, plus a count badge (e.g. "POS Orders (47)"). The Track dialog stays the same — both tabs reuse `AdminOrderTrackingDialog`. Filtering, search, date range, and CSV export work per tab.

Why split: POS rows clutter the online operations view (no rider, no promo, no delivery type) and admins audit them separately.

## 2. New Screen: "On-Hold Payments"

Add a new sidebar item in the Admin Portal between **Payouts** and **Customer Wallets**, called **On-Hold Payments**. This is the single review queue for any money the platform is currently holding back from a Vendor, Rider, or Logistics Company.

### What appears in the queue
A row is shown when any of these conditions apply:
- An order is in **dispute** and the vendor/rider share is frozen
- A vendor/rider/company is **suspended** with unpaid earnings
- A withdrawal was **flagged** for manual review (e.g. mismatched bank name)
- A **fault** was logged against the party (e.g. missing item, late delivery) and the share has not yet been released or deducted
- Earnings sitting beyond the normal **settlement period** for an unusual reason

### Each row shows
- Party type (Vendor / Rider / Logistics Company) + name
- Related order # (if applicable) — clickable, opens the existing tracking dialog
- Amount on hold (₦)
- Reason hold was placed (auto-filled from the source: dispute, fault, suspension, etc.)
- Days held
- Action button: **Resolve**

### Resolve dialog (per row)
The admin picks one of two outcomes and **must enter a reason** (free text, min 10 chars):

1. **Platform absorbs** — money is written off the party's pending balance; platform takes the loss. A `wallet_transactions` adjustment removes it from the held bucket; nothing credits the party.
2. **Release to party** — money moves from held → eligible balance for the party, so it pays out on their next withdrawal cycle.

The reason is stored on the resolution record so it appears in the Refund Audit log and in the party's payout history.

## 3. Audit Trail

Every resolve action writes to a new `payment_hold_resolutions` table:
- party type / id, order id (nullable), amount, decision (`absorbed` / `released`), reason, admin id, timestamp

This row feeds the existing **Refund Audit** screen with a new "Hold Resolution" filter so the team can later trace any decision.

## Technical details

- New table `payment_hold_resolutions` (party_type enum, party_id uuid, order_id uuid nullable, amount numeric, decision text, reason text, resolved_by uuid, resolved_at timestamptz). RLS: admins only.
- New view `admin_on_hold_payments` that unions:
  - `wallet_transactions` rows where `status = 'held'` or category in (`hold_dispute`, `hold_fault`, `hold_suspension`)
  - Disputes flagged `frozen` not yet resolved
  - Withdrawal requests with `status = 'flagged'`
  Excludes any party_id+order_id already in `payment_hold_resolutions`.
- Edge function `resolve-payment-hold` (verify_jwt + admin role check):
  - Input: `party_type`, `party_id`, `order_id?`, `amount`, `decision`, `reason`
  - Inserts `payment_hold_resolutions` row, then writes the matching `wallet_transactions` adjustment (insert-first idempotency keyed on resolution id) — never touches wallet table directly (respects `prevent_balance_manipulation`).
- Frontend:
  - `src/pages/admin/AdminOrders.tsx` — wrap table in `<Tabs>` (online | pos), filter by `order_type`.
  - New page `src/pages/admin/AdminOnHoldPayments.tsx` + route + sidebar entry.
  - New component `ResolveHoldDialog.tsx` (shadcn Dialog + RadioGroup + Textarea, 10-char min validation).
  - Hook `useOnHoldPayments` querying the view; mutation `useResolvePaymentHold` calling the edge function.
- Refund Audit screen: add a "Source" filter chip including "Hold Resolution".

## Out of scope (for this batch)
- Bulk resolve (multi-select)
- Notifications to the affected party — can be added in a follow-up
- Editing a resolution after the fact (audit-immutable for now)
