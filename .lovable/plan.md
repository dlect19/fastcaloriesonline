# Voucher Hub — Auto-credit fix, Confirmation emails, Location grouping

## Findings from investigation

**#1 Root cause of missing wallet credit for Jul 26 sale (order `eb84742e`):**
- The credit function `credit_vendor_wallet_for_voucher` works correctly when called (I just ran it manually and it credited ₦2,250 into pending pool with proper ledger row).
- All three call sites (`purchase-voucher`, `paystack-webhook → handleVoucherGuestPurchase`, `voucher-guest-lookup`) invoke the RPC, BUT they each swallow errors:
  - `voucher-guest-lookup:84` — uses `.catch(() => {})` — silent
  - `paystack-webhook:906` and `purchase-voucher:125` — only `console.error`, no retry, no marker on the order
- Because `voucher-guest-lookup` fulfils inline when the buyer lands on the success page before the Paystack webhook arrives, and both the webhook and lookup race, a transient RPC failure (network blip, lock contention, service-role token hiccup) leaves the `voucher_orders` row inserted with **no** ledger credit and no visible trace.
- No signal on the order itself distinguishes "credited" from "not credited", so there's nothing to detect the drift.

**#2 Confirmation email:** No email is being sent anywhere. There is no call to `send-transactional-email` in `purchase-voucher`, `voucher-guest-lookup`, or `paystack-webhook`'s voucher branch. It was never wired.

**#3 Location grouping:** Currently `voucher_categories.vendor_id` is a direct FK. A `voucher_locations` layer needs to sit between vendor and categories.

---

## Part 1 — Auto-credit voucher wallet at source (no more backfills)

Move the credit into a **database trigger** so it is impossible to insert a paid `voucher_orders` row without a wallet credit attempt.

1. **Migration:**
   - Add columns to `voucher_orders`: `wallet_credited_at TIMESTAMPTZ`, `wallet_credit_error TEXT`.
   - Refactor `credit_vendor_wallet_for_voucher(_order_id uuid)` to set `wallet_credited_at = NOW()` on success and store any exception message in `wallet_credit_error` (via a nested `BEGIN … EXCEPTION` block) so failures are visible on the row itself.
   - Add trigger `trg_voucher_order_credit_wallet` AFTER INSERT OR UPDATE OF status ON `voucher_orders` — when NEW.status='paid' AND wallet_credited_at IS NULL, call the credit function. Trigger runs as SECURITY DEFINER via a wrapper.
   - Add trigger `trg_voucher_order_email` AFTER INSERT OR UPDATE OF status calling `pg_notify('voucher_paid', order_id)` — used only as a marker; actual email is invoked from the edge functions (see Part 2) since Postgres cannot call HTTP.

2. **Edge functions:**
   - `purchase-voucher`, `paystack-webhook → handleVoucherGuestPurchase`, and `voucher-guest-lookup`:
     - Remove the `.catch(() => {})` swallow; log with tag `[voucher-credit]`.
     - After insert of the `voucher_orders` row, re-read `wallet_credited_at`. If null after RPC, log `[voucher-credit] MISSED` with order id, vendor id, reference — this makes future misses grep-visible in edge logs.
     - The trigger is now the primary path; the explicit RPC call becomes a belt-and-suspenders safety.

3. **Backfill the Jul 26 sale (`eb84742e`)** in the same migration — already re-credited during investigation, but the migration will `SELECT credit_vendor_wallet_for_voucher(id) FROM voucher_orders WHERE status='paid' AND wallet_credited_at IS NULL` to catch any others in one pass.

## Part 2 — Wire voucher confirmation email

1. **New template** `supabase/functions/_shared/transactional-email-templates/voucher-purchase-confirmation.tsx` — matches the on-screen voucher preview (vendor name, category, code, value, expiry, purchase timestamp) with a note that the voucher image is also available in-app.
2. Register in `TEMPLATES` registry.
3. **Invoke from the three completion paths** (`purchase-voucher`, `paystack-webhook.handleVoucherGuestPurchase`, `voucher-guest-lookup.fulfilVoucherPurchase`) using `supabase.functions.invoke('send-transactional-email', …)` with:
   - `templateName: 'voucher-purchase-confirmation'`
   - `recipientEmail`: buyer email (auth user email for logged-in, guest_email for guest)
   - `idempotencyKey: voucher-confirm-<order_id>`
   - `templateData`: vendor name, category, code, value, expiry_date, purchased_at
4. Log `[voucher-email]` success/failure explicitly. Email failure must NOT throw — the sale is already complete.
5. Confirm project has an email domain via `email_domain--check_email_domain_status` before scaffolding; if missing, surface the setup dialog.

## Part 3 — Location grouping for voucher vendors

### Schema
- **New table `voucher_locations`**: `id`, `vendor_id`, `name`, `is_active` (default true), `sort_order`, `created_at`, `updated_at`.
- **Alter `voucher_categories`**: add `location_id UUID REFERENCES voucher_locations(id) ON DELETE CASCADE`. Keep `vendor_id` (denormalised for RLS convenience, kept in sync with the location's vendor).
- **Migration data**: for each existing vendor with voucher_categories, create a default location "Main" and set `location_id` on all their categories. Then `ALTER COLUMN location_id SET NOT NULL`.
- RLS: policies match `voucher_categories` (owner + admin + public read of active), GRANTs to `authenticated` + `anon` (public storefront needs read) + `service_role`.

### Vendor dashboard (`VendorVoucherHub.tsx`)
- Add a Location selector at the top of the Voucher Hub tab (create/edit/delete locations, activate/deactivate).
- Categories, Stock tabs operate within the selected location — new categories are created with the current `location_id`.
- Template tab remains vendor-scoped (shared across all locations).
- Sales/Reconciliation tab shows a Location filter.

### In-app purchase flow (`src/pages/vouchers/VouchersList.tsx`, `VoucherCategory.tsx`)
- After selecting the vendor, show a Location picker before listing categories. Route: `/vouchers/:vendorSlug/:locationId`.
- `VoucherCategory` scoped to `(vendor, location, category)`.

### Public storefront (`src/pages/public/VoucherStorefront.tsx` + `voucher-storefront` edge function)
- The storefront edge function returns `{ vendor, template, locations: [{id, name, categories: […]}] }`.
- Front-end: after landing on `/v/:slug`, show Location grid → clicking a location reveals that location's categories in the existing Card/List view.
- If a vendor has exactly one active location, skip the selector automatically (backwards-compatible with single-site vendors).

### Guest checkout (`voucher-guest-initiate`)
- Accepts `categoryId` as before — `location_id` is inferred from the category row (no wire change needed for Paystack metadata).

---

## Technical notes / open decisions

- **Decision needed from you (non-blocking, sensible default chosen):** Vendors migrating in will get an auto-created "Main" location. If a vendor tells us they want a different default name (e.g. "Head Office"), they can rename it in the UI.
- Trigger-based crediting is idempotent because the credit function already short-circuits when a `VH-CREDIT-<id>` ledger row exists — safe to run from both trigger and explicit RPC.
- No breaking change to existing category IDs / URLs; only the storefront adds a location step.

## Files that will change

**DB migrations (one file):**
- `credit_vendor_wallet_for_voucher` refactor + new columns on `voucher_orders` + trigger + new `voucher_locations` table + `location_id` on `voucher_categories` + data backfill.

**Edge functions:**
- `supabase/functions/purchase-voucher/index.ts` — logging + email invocation.
- `supabase/functions/paystack-webhook/index.ts` — logging + email invocation in voucher branch.
- `supabase/functions/voucher-guest-lookup/index.ts` — remove `.catch(()=>{})`, add logging + email.
- `supabase/functions/voucher-storefront/index.ts` — return locations list.
- `supabase/functions/_shared/transactional-email-templates/voucher-purchase-confirmation.tsx` + registry.

**Front-end:**
- `src/pages/vendor/VendorVoucherHub.tsx` — location selector + scoped category/stock management.
- `src/pages/vouchers/VouchersList.tsx`, `VoucherCategory.tsx` — location step.
- `src/pages/public/VoucherStorefront.tsx` — location step.
- `src/hooks/useVoucherHub.ts` — new `useVoucherLocations` hook, `useVoucherCategories` accepts `locationId`.

Once approved I'll implement DB + auto-credit fix first (highest priority), then email wiring, then the location feature.
