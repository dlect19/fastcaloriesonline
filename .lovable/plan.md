
# Voucher Hub — Phase 1

A digital voucher marketplace built generically (starting with data/WiFi vouchers). Phase 1 covers vendor management, in-app customer purchase, admin oversight, and full data model so Phase 2 (guest checkout, wallet crediting, withdrawals) drops in cleanly.

## Assumptions (flag if wrong)

- **Payment**: Phase 1 in-app purchase uses the existing customer wallet (same pattern as food orders — "Order-First then Debit"). No Paystack direct-charge here; that belongs to Phase 2 guest checkout.
- **Voucher-hub commission is separate** from the existing food/vendor commission. It lives in a new `vendor_commission_rates` table dedicated to voucher sales so it doesn't collide with `commission_overrides`.
- **Template rendering**: Voucher image rendered client-side on an HTML `<canvas>` at purchase time and uploaded to a new `voucher-images` public storage bucket. Fixed layout as you specified (logo, vendor name, category, code, expiry, purchase timestamp).
- **CSV bulk upload**: Parsed client-side, inserted via a batched insert. Duplicate codes within the same category are rejected (unique constraint on `(category_id, code)`).
- **Wallet credit in Phase 1**: The `vendor_wallets` row is created and `commission_amount` is recorded on every order, but no automatic credit yet — Phase 2 will add the trigger/edge function that moves funds. Balance stays at 0.
- **Existing vendors only**: Any active vendor can use Voucher Hub. No new onboarding gate.
- **Currency**: Naira, matching platform.

## Data model (migration)

All in `public`, with GRANTs + RLS in the same migration.

- `voucher_categories` — `id, vendor_id, name, validity_days (int), is_active, created_at, updated_at`
- `voucher_codes` — `id, category_id, code, value (numeric), status ('available'|'sold'|'expired'), sold_at, order_id, created_at`; unique `(category_id, code)`
- `vendor_templates` — `id, vendor_id UNIQUE, logo_url, background_color, background_image_url, created_at, updated_at`
- `voucher_orders` — `id, buyer_user_id, vendor_id, category_id, code_id, amount, commission_amount, commission_rate, expiry_date, purchased_at, rendered_image_url, status ('paid'|'refunded'|'failed'), created_at`
- `vendor_wallets` — `id, vendor_id UNIQUE, balance (numeric default 0), updated_at` (Phase 2 will add ledger)
- `vendor_commission_rates` — `id, vendor_id UNIQUE, percentage (numeric nullable), updated_at`
- `platform_settings` key `voucher_hub_default_commission_pct` (default 10)

RLS summary:
- Vendors manage their own categories/codes/template; customers read active categories with stock; buyers read their own orders; admins read all.
- `vendor_wallets`: vendor reads own, admin reads all, no client writes (service role only).
- Storage: new public bucket `voucher-images` (rendered vouchers) + reuse `campaign-images` for logos/backgrounds.

## Backend

- **Edge function `purchase-voucher`**: authenticated. Validates wallet balance → picks one `available` code (row-locked) → marks it `sold` → creates `voucher_order` with `commission_amount = amount * effective_rate/100` → debits customer wallet via existing ledger pattern → returns order + code + expiry. Wallet-credit to vendor is a TODO comment for Phase 2.
- **Helper SQL function `get_vendor_voucher_commission(vendor_id)`** returning the override or platform default.

## Frontend

**Vendor (`/vendor/voucher-hub`)**
- Tabs: Categories · Stock · Template · Sales
- Categories: create/edit (name, validity in days with presets 7/30/90/custom)
- Stock: pick category → CSV upload (drag-drop) + manual add + table with status filter
- Template: single form (logo upload via existing `ImageUploadField`, color picker or background image) + live preview via shared `<VoucherPreview />` component
- Sales: total sold, remaining stock per category, read-only wallet balance card

**Customer (`/vouchers`)**
- Grid of vendors with active categories that have stock
- Category detail → "Buy for ₦X" → wallet confirm → success dialog shows the rendered voucher (`<VoucherPreview />`), download button, "View in My Vouchers"
- `/vouchers/my` — purchased voucher history

**Admin (`/admin/voucher-hub`)**
- KPIs: total sold, revenue, commission earned (all-time + this month)
- Breakdown table by vendor and by category
- Commission control: platform default input + per-vendor override table

## Shared component

- `<VoucherPreview vendor category code expiry purchasedAt template />` — used identically in vendor preview, purchase success dialog, and admin previews. Also exposes `renderToBlob()` for canvas → PNG upload.

## Nav wiring

- Add "Voucher Hub" to `VendorSidebar` (feature-gated behind existing vendor auth).
- Add "Vouchers" entry to customer nav (Explore area).
- Add "Voucher Hub" to `AdminSidebar`.

## Files to create

Migration (1), edge function `purchase-voucher/index.ts`, and roughly:
- `src/pages/vendor/VendorVoucherHub.tsx`
- `src/components/vendor/voucher/{CategoriesTab,StockTab,TemplateTab,SalesTab,CsvUploadDialog}.tsx`
- `src/pages/vouchers/{VouchersList,VoucherCategory,MyVouchers}.tsx`
- `src/components/vouchers/{VoucherPreview,PurchaseSuccessDialog}.tsx`
- `src/pages/admin/AdminVoucherHub.tsx`
- `src/hooks/{useVoucherCategories,useVendorTemplate,useVoucherPurchase}.ts`
- Route wiring in `App.tsx` + sidebar entries

## Out of scope (Phase 2)

Public no-login storefront, Paystack guest checkout, email delivery of voucher image, automatic wallet crediting per sale, vendor withdrawals.

## Decisions I'd like you to confirm before I build

1. **Payment source for Phase 1 in-app buyers**: use customer wallet (matches existing food-order pattern) — OK?
2. **Separate commission table** (`vendor_commission_rates`) dedicated to voucher hub, vs reusing existing `commission_overrides` with a new entity_type — I'd prefer separate for clean Phase 2 wallet wiring. OK?
3. **Template**: one canvas layout, fixed — confirm you don't also want a couple preset layouts to pick from.

If all three are OK, reply "go" and I'll build straight through.
