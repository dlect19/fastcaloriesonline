
# Voucher Vendor account type + Voucher Hub Phase 2

## 1. "Voucher Vendor" as a vendor category

Extend the existing `vendor_category` enum with a new `'voucher'` value so voucher vendors sign up through the exact same flow as restaurants / pharmacies / markets.

- **DB migration**: `ALTER TYPE public.vendor_category ADD VALUE 'voucher'`. No new auth surface.
- **Vendor signup (`src/pages/vendor/VendorAuth.tsx`)**: add a "Voucher Hub" option to both the create-business and link-business business-category selects. Voucher vendors still get a default `vendor_outlets` row like other categories (needed so the existing wallet, which is keyed by `user_id + wallet_type='vendor' + outlet_id`, still works).
- **Vendor dashboard routing**: when `vendor.category === 'voucher'`, the sidebar shows only voucher-relevant sections (Voucher Hub, Orders/Sales, Withdraw, Settings, Support) and hides restaurant/pharmacy-only entries (Menu, Hours, POS, Riders, etc.). Voucher Hub becomes the default landing page for that category.
- **Admin (`src/pages/admin/AdminVendors.tsx`)**: add a category filter with the new "Voucher" option so admin can filter/approve voucher vendors distinctly.

## 2. Voucher Hub Phase 2

### Public storefront (no login)
- Add a `slug` column to `vendors` (unique, auto-generated from business name on signup / migration backfill).
- New public route `/v/:slug` served by `src/pages/public/VoucherStorefront.tsx`. Fetches the vendor + their voucher categories + their brand template via a new **public** edge function `voucher-storefront` (uses service role, only returns non-sensitive fields, filters to `category='voucher'` + approved vendors).
- Storefront lists categories with price, remaining-stock indicator, and a "Buy" button that opens a guest checkout dialog: email input + Paystack inline.

### Guest checkout via Paystack
- New edge function `voucher-guest-initiate` — validates category, computes amount, initializes a Paystack transaction with metadata `{ category_id, guest_email, vendor_id }`, returns `authorization_url` + `reference`.
- Existing `paystack-webhook` extended to detect `metadata.type === 'voucher_purchase'` and call a shared handler `assignVoucherAndCredit()` that:
  1. Atomically reserves the next `available` voucher code for that category (row-locked `UPDATE ... WHERE status='available' LIMIT 1 RETURNING *`).
  2. Creates a `voucher_orders` row (`buyer_user_id` null for guests, `guest_email` set).
  3. Renders the vendor's branded template server-side (see below) and stores PNG in the existing `voucher-images` storage bucket; saves signed URL on the order.
  4. **Credits the vendor wallet** (see wallet section).
  5. Emails the buyer via the existing `send-transactional-email` function with a new template `voucher-delivery` that embeds the rendered image URL.
- Guest success page `/v/:slug/success?ref=...` polls the order by reference and renders the same voucher image on-screen.

### Wallet crediting — reuses existing vendor wallet + withdrawal system
The existing withdrawal flow reads from `wallets` (keyed by `user_id`, `wallet_type='vendor'`, `outlet_id`) and creates `payout_requests`. To avoid a parallel system, voucher sales credit the SAME `wallets` row used by restaurants/pharmacies:
- On every voucher sale (both Phase 1 in-app flow and Phase 2 public flow), insert a `wallet_transactions` row: `wallet_type='vendor'`, `transaction_type='credit'`, `category='voucher_sale'`, `amount = sale − commission`, `reference = voucher order id`. This is the audit ledger you asked for — `wallet_transactions` already serves that role for every other vendor earning, so we reuse it instead of creating a parallel `vendor_wallet_transactions` table.
- Update the vendor `wallets` row's `balance` (or `test_balance` per environment) by the net amount, respecting the existing `prevent_balance_manipulation` trigger (do it through a `SECURITY DEFINER` helper `credit_vendor_wallet_for_voucher(order_id)` — same pattern as other order-completion credits).
- Phase 1 stub tables `vendor_wallets` and `vendor_wallet_transactions` are **deprecated** — I'll leave the tables in place (harmless, no code will write to them) but rewire the `purchase-voucher` edge function and admin queries to the real `wallets` / `wallet_transactions`. Flag: this is the one deviation from your spec — see "Decisions needed" below.

### Withdrawals
No new code. Because voucher balances live in the same `wallets` row, the vendor's existing `VendorWithdraw.tsx` page and admin `AdminPayouts.tsx` already work; voucher sales just show up as additional credits. Admin filter on `AdminPayouts` gets a small "vendor category" column for clarity.

### Server-side template rendering
Phase 1 renders vouchers to a canvas in the browser — that's not available in an edge function for the email/guest flow. I'll add a shared `renderVoucherPng()` helper in `supabase/functions/_shared/voucher-render.ts` using Deno's `@napi-rs/canvas`-compatible Skia bindings (or fall back to a simple SVG-to-PNG via `resvg-wasm`) that mirrors the client layout. Both the Phase 1 flow (updated) and Phase 2 webhook use this so the image is identical whether purchased in-app or via storefront.

## Files touched

**Migration** (one)
- Add `'voucher'` to `vendor_category`, add `vendors.slug` (unique), backfill slugs, add `credit_vendor_wallet_for_voucher(uuid)` SECURITY DEFINER function, GRANTs.

**Frontend**
- `src/pages/vendor/VendorAuth.tsx` — add voucher option in both selects
- `src/components/vendor/VendorSidebar.tsx` — category-gated menu
- `src/pages/admin/AdminVendors.tsx` — category filter incl. voucher
- `src/pages/admin/AdminPayouts.tsx` — small category label column
- `src/pages/public/VoucherStorefront.tsx` (new) + `VoucherStorefrontSuccess.tsx` (new)
- `src/App.tsx` — add `/v/:slug` and success route
- `src/pages/vendor/VendorVoucherHub.tsx` — surface the public link ("Share your storefront") using the vendor's slug

**Edge functions**
- `voucher-storefront` (new, public)
- `voucher-guest-initiate` (new, public)
- `paystack-webhook` (extend for voucher purchases)
- `purchase-voucher` (rewire to credit real `wallets` + `wallet_transactions`)
- `_shared/voucher-render.ts` (new)

**Email**
- New template `supabase/functions/_shared/transactional-email-templates/voucher-delivery.tsx`

## Decisions needed
1. **Ledger table**: existing vendor earnings already flow through `wallet_transactions`, and reusing it is what makes the "reuse existing withdrawal system" requirement actually work with zero new plumbing. I plan to skip the new `vendor_wallet_transactions` table and use `wallet_transactions` with `category='voucher_sale'` — same auditability. OK to proceed this way? (Alternative: keep a parallel `vendor_wallet_transactions` that mirrors every credit — extra write on every sale, no functional benefit.)
2. **Voucher vendor outlet**: to plug into the existing wallet/withdrawal schema (which requires an `outlet_id`), voucher vendors will get one auto-created "Main" outlet on signup with no address requirements. OK?
3. **Storefront URL**: `/v/:slug` on the app domain (`app.fastcalories.online/v/mtn-store`). Confirm — or do you want it on the marketing domain?
