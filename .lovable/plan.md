# Assisted Ordering System — Implementation Plan

A staff-only "Concierge" tool that lets admins create real FastCalories orders on behalf of customers who reach out via phone, WhatsApp, SMS, or social. Every assisted order becomes a regular `orders` row, so it flows through the existing vendor → rider → tracking → wallet → notification pipeline. **No parallel workflows are introduced.**

---

## 1. Scope of this first build

Because this spec is very large, I'll deliver it in **two phases**. This plan covers **Phase 1 (core MVP)** end-to-end. Phase 2 items are listed at the bottom and I'll build them next once you approve Phase 1.

### Phase 1 — In scope
1. New admin section **Operations → Assisted Orders** with:
   - Create Order wizard
   - List / filter / search
   - Order detail (track, resend payment link, resend OTP, cancel)
   - Repeat previous order
2. Customer + Receiver capture (payer ≠ receiver supported)
3. Address picker reusing existing `MapLocationPicker` (autocomplete, drop pin, paste coordinates / Google Maps link / WhatsApp location link)
4. Vendor + product selection reusing existing vendor menu data; quantities, special instructions
5. Pricing reuses existing delivery-fee + service-fee + promo engine — no duplication
6. Customer auto-provisioning (profile row by phone, no auth account yet; can be claimed later via existing OTP login)
7. Order insertion into existing `orders` table with `source = 'assisted'` and an `assisted_order_meta` row for concierge-specific data
8. Payment: generate Paystack payment link + bank-transfer instructions; auto-verify via existing Paystack webhook OR mark as manually confirmed by staff
9. After payment confirmed → order automatically becomes a normal pending order (vendor sees it, rider gets dispatched, tracking link works, delivery OTP issued — all via the existing pipeline)
10. Public tracking link `/track/:orderNumber` (no login)
11. Delivery OTP — reuse existing per-order code
12. Notifications via existing engine (SMS/email/push); resend buttons for payment link + OTP
13. Audit trail (`created_by`, `payment_verified_by`, `last_modified_by`, change log)
14. Pharmacy support: OTC flows normally; prescription uploads attach to the existing prescription workflow
15. Communication notes field on the order (free-text log of phone/WhatsApp conversation)
16. RBAC: gated by a new `manage_assisted_orders` admin permission (Super Admins always allowed)

### Phase 2 — Deferred (next batch)
- Analytics dashboard (revenue, top vendors, repeat customers, conversion)
- Twilio WhatsApp two-way integration + "create order from chat"
- AI order assistant, voice ordering, corporate / bulk orders
- Saved address book picker on the concierge form (Phase 1 saves addresses but doesn't show a picker beyond the customer's existing list)

---

## 2. Database changes

One migration. All new tables use `service_role` + scoped `authenticated` grants and RLS.

- **`orders`** — add columns:
  - `source TEXT DEFAULT 'app'` (`app` | `assisted` | `pos` | `whatsapp`)
  - `assisted_created_by UUID` (admin user id, nullable)
  - `receiver_name TEXT`, `receiver_phone TEXT` (nullable — only when payer ≠ receiver)
  - `communication_notes TEXT`
- **`assisted_orders`** — concierge metadata:
  - `order_id` (FK to `orders`, unique)
  - `customer_channel` (`phone` | `whatsapp` | `sms` | `facebook` | `instagram` | `other`)
  - `channel_reference` (e.g. WhatsApp thread id, call note id)
  - `payment_method` (`paystack_link` | `bank_transfer` | `wallet` | `cash`)
  - `payment_link`, `payment_reference`, `payment_status` (`awaiting` | `received` | `failed` | `cancelled`)
  - `payment_verified_by`, `payment_verified_at`
  - `created_by`, `last_modified_by`
- **`assisted_order_audit`** — append-only change log (`order_id`, `actor_id`, `action`, `details jsonb`, `created_at`)
- **`admin_permissions` enum / mapping** — add `manage_assisted_orders` permission key (matches existing `useAdminPermissions` pattern)

RLS:
- `assisted_orders` and `assisted_order_audit`: only admins with `manage_assisted_orders` (via existing `has_admin_permission` helper) or Super Admin can read/write; `service_role` full access for edge functions.
- Public tracking does **not** read these — it reads `orders` via a safe `SECURITY DEFINER` function keyed by order number (already pattern used elsewhere) plus a new variant if needed.

---

## 3. Edge functions

- `assisted-order-create` — validates input (zod), upserts customer profile by phone, inserts `orders` + `order_items` + `order_packages` + `assisted_orders`, computes pricing via the same RPCs used by the customer cart, returns order id + payment link.
- `assisted-order-payment-link` — generates a Paystack payment link (existing Paystack edge function pattern) and bank-transfer instructions; stores `payment_link`/`payment_reference`.
- `assisted-order-verify-payment` — manual confirmation by staff; also called by Paystack webhook fan-out for `source='assisted'` orders to flip status to paid and release the order to the vendor (`status = 'pending_vendor'` — same status the normal checkout uses).
- `assisted-order-notify` — wraps existing notification helpers to resend payment link, resend delivery OTP, send tracking link via SMS/email/push.
- `assisted-order-repeat` — clones the last order for a given customer into a draft assisted order.

All five are server-validated, JWT-checked (admin role), and write to `assisted_order_audit`.

---

## 4. Frontend

New files under `src/pages/admin/assisted/`:
- `AssistedOrdersList.tsx` — table with filters (date, vendor, customer, status, channel)
- `AssistedOrderCreate.tsx` — multi-step wizard: Customer → Address → Vendor → Items → Review → Payment
- `AssistedOrderDetail.tsx` — status, tracking, resend buttons, audit timeline, cancel
- Shared components under `src/components/admin/assisted/`:
  - `CustomerLookupStep.tsx` (phone search → existing profile or create new; receiver fields)
  - `AddressStep.tsx` (reuses `MapLocationPicker`; adds paste-link / paste-coordinates parser for Google Maps / WhatsApp share URLs)
  - `VendorStep.tsx` (reuses nearby-vendor logic)
  - `ItemsStep.tsx` (reuses vendor menu + cart math)
  - `ReviewStep.tsx` (totals via existing pricing hook)
  - `PaymentStep.tsx` (payment method, link generation, mark-as-paid)
  - `AuditTimeline.tsx`

Sidebar: add **Assisted Orders** entry under Operations, gated by `manage_assisted_orders`.

Public tracking: a lightweight `src/pages/Track.tsx` at `/track/:orderNumber` that calls an existing/new public RPC and shows the status timeline + rider ETA (reuses existing tracking components where possible). No auth required.

Phone numbers everywhere reuse `src/lib/phoneValidation.ts` (11 digits, no country code).

---

## 5. Integration guarantees (the "do NOT duplicate" rules)

- Order goes into the same `orders` table → vendor dashboard, rider dispatch, tracking page, wallet ledger, payouts, disputes, ratings all work unchanged.
- Pricing uses the same hooks/RPCs as the customer cart (`useDeliveryFee`, `useServiceFee`, promo engine, takeaway packs).
- Delivery OTP uses the existing per-order confirmation code (no parallel OTP table).
- Notifications use the existing notification engine (no new sender).
- Pharmacy prescription uploads use the existing `prescriptions` / `prescription_orders` tables.
- Customer profile auto-created without an auth user; when the customer later signs up with the same phone, existing claim logic links the historical orders.

---

## 6. Open questions before I build

1. **Payment methods for Phase 1** — confirm I should support **Paystack link + Bank transfer + Mark-as-paid (cash)**. Wallet debit from a customer who hasn't logged in isn't possible, so I'll skip wallet for assisted orders unless you want it for already-registered customers.
2. **Public tracking** — OK to expose order status + rider first name + ETA only (no PII like phone) on `/track/:orderNumber`?
3. **Customer claim flow** — when an auto-created (no-auth) customer later signs up with the same phone, auto-link prior assisted orders to their new auth account?

If you're happy with these defaults (yes / yes / yes), I'll proceed with Phase 1 immediately.
