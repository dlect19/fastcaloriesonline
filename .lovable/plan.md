# Event Ticketing + Food Voucher + QR Verification

This is a large, multi-phase module. I'll integrate it cleanly into the existing FastCalories infrastructure (wallet payments, vendors, combos, notifications, customer app) rather than building a parallel system.

Given the scope, I propose shipping in **4 phases** so each phase is stable, testable, and you can start using it before the next ships. Please confirm the phasing (or tell me to compress it).

---

## Phase 1 — Foundation: Events + Tickets + Purchase + QR

**Database**
- `events` — name, banner, description, location (text + lat/lng optional), date, start/end time, organizer, capacity, terms, status (draft/published/paused/cancelled/completed)
- `event_ticket_types` — event_id, name, image, price, qty_available, qty_sold, max_per_customer, sales_start, sales_end
- `event_tickets` — issued tickets: id, ticket_code (short, human-readable), qr_token (random secure), user_id, event_id, ticket_type_id, order_id, status (unused/checked_in/cancelled/expired), checked_in_at, checked_in_by
- `event_ticket_orders` — purchase grouping, payment_status, amount, payment_reference
- RLS: customers see own tickets; admins (via `has_role`) manage everything; event-verifier role can update check-in.

**Payment integration**
- Reuse existing wallet-first checkout pattern (`Order-First then Debit`), plus Paystack fallback through existing `paystack-initialize-payment` style edge function (new edge fn `purchase-event-ticket`).
- Stock decrement is atomic via DB function with row lock to prevent overselling.

**Admin UI** (`/admin/events`)
- List/Create/Edit/Pause/Publish/Cancel events
- Manage ticket types per event (CRUD, low-stock badge, sold-out auto)
- Basic analytics card (sold, revenue, remaining, check-ins)

**Customer UI**
- Home page landscape **Events carousel** (above vendor list)
- `/events/:id` — details, ticket types, buy button
- `/my-events` — purchased tickets with QR images
- Ticket detail screen renders QR (qrcode lib) + ticket code

**Verification UI** (`/admin/event-verify` or staff-scoped)
- Camera QR scanner (`html5-qrcode`) + manual code entry
- Edge function `verify-event-ticket` validates token, marks checked_in atomically, returns Valid / Already Used / Invalid / Expired

**Notifications**
- Push + email on purchase (reuse existing transactional email infra)

---

## Phase 2 — Food Voucher System

**Database**
- `event_voucher_templates` — attached to ticket_type: reward_type (none/food/discount/merch), vendor_id, combo_id (FK to existing combos), redemption_mode (venue/delivery/both), delivery_rule (free_food/free_food_paid_delivery/free_food_free_delivery), sponsor (fastcalories/vendor/organizer), expires_at_rule
- `event_vouchers` — issued per ticket: id, voucher_code, qr_token, ticket_id, user_id, vendor_id, combo_id, status (generated/reserved/redeemed/expired/cancelled), redemption_method, redeemed_at, redeemed_vendor_id, sponsor
- Trigger: when ticket created, auto-generate voucher rows from template.
- Separate QR namespace from tickets (different token prefix) so a ticket QR cannot be redeemed as voucher.

**Admin UI**
- On ticket-type form: add voucher template (vendor picker → combo picker, redemption mode, sponsor, delivery rule)

**Vendor venue redemption** (`/vendor/voucher-verify`)
- Scoped to the vendor's own outlet; QR scanner; only validates vouchers tied to that vendor; atomic mark-redeemed.

**Customer delivery redemption**
- `/my-events` → "Redeem for delivery" button on eligible vouchers
- Creates a normal FastCalories order pre-loaded with the voucher's combo from the correct vendor, applies 100% discount on that combo line, applies delivery rule (fee/free)
- Voucher moves to `reserved` until order completes → `redeemed`; auto-revert to `generated` if order cancelled.

**Sponsor accounting**
- New `voucher_settlements` ledger entry per redemption — vendor still gets paid via existing payout flow; sponsor bucket is debited (FC platform expense, vendor self-funded write-off, or organizer invoice line). Reuses `wallet_transactions` ledger pattern.

---

## Phase 3 — Analytics, Notifications, Wallet Polish

- Admin analytics dashboard per event: sold, revenue by type, check-in rate, vouchers issued/redeemed/expired, conversion rate
- Customer **My Events**: upcoming, history, rewards tab, voucher statuses
- Notifications: event reminder (24h before), starting soon (1h before), voucher available, voucher redeemed, voucher expiry reminder (cron via pg_cron + existing push/email infra)
- Repeating sound alerts already exist for admin/rider — extend to ticket-sale alerts only if you want (off by default).

---

## Phase 4 — Future-Ready Hooks (schema only, no UI yet)

Schema fields/tables stubbed but inactive:
- `event_organizers` table (so vendor-created and organizer-created events work later)
- `created_by_type` (admin/vendor/organizer) on events
- `event_promo_codes`, `referral_tickets`, `group_tickets`, `event_merchandise`, `event_seats`
- Keeps Phase 1–3 code clean while making expansion non-breaking.

---

## Technical Notes (for engineers)

- **QR library:** `qrcode` for generation (client + edge fn), `html5-qrcode` for scanning. Both lightweight.
- **Ticket code format:** `FC-EVT-XXXX-XXXX` (Crockford base32, 8 random chars) for manual entry; QR carries a separate signed token.
- **Atomic check-in:** Postgres function `check_in_ticket(qr_token, staff_id)` with row-level lock returning status.
- **Atomic stock:** `purchase_event_tickets(...)` function decrements `qty_sold` with `FOR UPDATE` to prevent oversell.
- **Voucher ↔ combo:** reuses existing `combos` table — no parallel menu system.
- **RLS:** verifier role via existing `user_roles` + new `event_verifier` enum value; vendor voucher scanner scoped via `owns_vendor`.
- **No changes to existing order flow** for non-event orders — event tickets are a separate order namespace.
- **Settlement holds:** event ticket revenue uses existing vendor settlement-period system if event is vendor-owned; admin-owned events settle to platform wallet.

---

## Confirmation needed before I start

1. **OK with 4-phase rollout?** (Phase 1 first, ~big migration + ~15 files)
2. **Who scans tickets at the venue?** Admin staff only, or do we need a dedicated lightweight "event verifier" role/login?
3. **Default voucher sponsor when admin creates a ticket?** FastCalories-sponsored, or force admin to pick every time?

Once you confirm, I'll start Phase 1 immediately.