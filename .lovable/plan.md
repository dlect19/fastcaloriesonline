# Audit report: four suspected production bugs

No code, data, settings or deployments were changed. All database reads were read-only.

---

## Severity summary

| # | Issue | Severity | Status |
|---|---|---|---|
| C | Delivery fee is never verified by the server; customer's device decides the price | **Critical** | Confirmed |
| A | Availability lives in two different places; WhatsApp and Assisted Order ignore one of them | **High** | Confirmed |
| B | New items/photos silently missing from the home carousel + failed photo upload still saves the item | **High** | Confirmed |
| C2 | Second map key name is not configured, so WhatsApp distance quietly uses straight-line estimates | **Medium** | Confirmed |
| D | Carryout → Delivery switch keeping a low fee | **Low** | Not reproduced in code; one narrow race remains |

---

## A) Menu availability desync — Confirmed (High)

There are two separate "available" records, and they disagree:

1. `products.is_available` (whole business) plus `products.is_hidden`.
2. `outlet_product_overrides(outlet_id, product_id, is_available)` (per branch).

Vendor toggle (`src/pages/vendor/VendorMenu.tsx`):
- With a branch selected → writes only `outlet_product_overrides` (lines 668-680).
- With no branch selected → writes only `products.is_available` (line 689-691).
- Effective value is merged in the client only: `getEffectiveAvailability` (lines 634-639).
- Combo availability cascade runs only in the no-branch mode (lines 698-758), so branch-level toggles never update combos.

Read paths, and what each one actually honours:
- Customer web/mobile `src/pages/VendorDetail.tsx:210-260` — the only correct path: `is_hidden=false` + merges branch overrides, with realtime channels (lines 314, 350).
- `supabase/functions/whatsapp-webhook/index.ts:2046-2054` — no availability filter at all and no branch-override join; label only reflects the global flag. NL search at 826-831 filters nothing.
- `supabase/functions/wa-session/index.ts:121-122` — filters global flags but never joins branch overrides.
- `src/pages/admin/AssistedOrderCreate.tsx:161-171` — no `is_hidden` filter, and filters on the legacy `products.outlet_id` column instead of the override table, so branch-level toggles have zero effect there.

Live evidence:
- 314 products, 306 available, 8 unavailable; 66 override rows exist, so both systems are in active use.
- 258 of 314 products have `outlet_id = NULL`; nothing in the vendor UI ever writes that column, confirming the Assisted Order filter is checking a column the toggles never touch.
- Write permission: the `products` "manage" policy allows only owner/manager (`get_vendor_staff_role ... owner|manager`). A **cashier** toggling availability gets a silent zero-row update — the UI then shows the new state locally while nothing changed in the database. Admin's toggle (`src/pages/admin/AdminVendorMenus.tsx:155-162`) writes both the override and the global flag, a third write shape.
- No `products` trigger flips `is_available` (only `updated_at`, prescription sync, pharmacy stock default).

## B) New items and images not appearing — Confirmed (High)

- Photo upload failure is swallowed: `VendorMenu.tsx:392-422` returns `null` on storage error, and `handleSubmit` (438-440, 469) still saves with `image_url: null` and shows "Product added successfully". Vendor believes it worked.
- Home carousel blackout: `src/components/home/MenuCarousel.tsx:124-153` only shows products whose vendor has a branch with `is_active AND is_approved`. Live data: branches are 23 active+approved, 5 inactive+approved, 2 inactive+not-approved, and `is_approved` defaults to `false`. **4 vendors currently have their entire menu excluded from the home carousel** while still visible on their own store page.
- Every product created in the last 60 days has `outlet_id` NULL and `category_id` NULL (296 of 314 overall have no category), so any category-filtered browse surface (`src/pages/Explore.tsx:95-99`) cannot find them.
- Storage itself is fine: `vendor-assets` bucket is public, public URLs correctly formed, paths match the owner policy.
- Reverse failure also unhandled: upload succeeds, insert throws → orphaned file, no item.

## C) Distance, weather and delivery undercharging — Critical

The APIs are *working*; the pricing trust model is the real bug.

- Google Distance Matrix is live: `api_usage_log` shows 16 successful `google_maps/distance_matrix` calls (latest 2026-09-10 17:44) vs 1 haversine fallback. Weather is live too: `weather_cache` refreshed 2026-09-10 17:44 via open-meteo, `weather_service_enabled = true`.
- **No server-side price validation anywhere.** The browser inserts the order row directly (`src/components/cart/VendorCheckoutSection.tsx:470-500`) with its own `delivery_fee` and `total`. The insert policy only checks `auth.uid() = user_id` — no bound on amounts. `process-wallet-payment/index.ts:113-134` charges `Number(order.total)` as stored; `paystack-webhook/index.ts:185` reconciles against the stored fee; rider payout triggers split `NEW.delivery_fee`. There is no `create-order` function at all. So any client-side value — tampered, buggy, or from a stale calculation — becomes the charged and settled amount.
- Fallback path silently underprices long trips: if the distance call fails or coordinates are missing, `useDeliveryFee.ts` falls back to plain `base_delivery_fee` (₦500) regardless of real distance. Live orders show repeated flat ₦500 fees (FC-260910-1520, FC-260910-8418, FC-260909-0319, FC-260831-5551) alongside distance-derived ones (₦815, ₦1,360, ₦2,250) — consistent with fallback-priced trips. With `per_km_fee = 350`, a 10 km trip priced at base only undercharges roughly ₦3,150.
- Key-name split: functions read two different secrets. `GOOGLE_MAPS_KEY` is configured; `GOOGLE_MAPS_API_KEY` — used by `supabase/functions/_shared/map-provider.ts:22-23` and `whatsapp-webhook/index.ts:1913,1938` — is not, so those paths degrade to straight-line distance silently.

## D) Carryout → Delivery low fee — Not reproduced (Low)

The switch does force a fresh calculation: `src/components/cart/VendorGroupCard.tsx:36-45` nulls the coordinates while carryout, and `useDeliveryFee.ts`'s effect dependencies re-fire a fresh distance lookup when they become numbers again. Charged fee is gated on `deliveryType` (`VendorGroupCard.tsx:47`, `VendorCheckoutSection.tsx:122-124`), and checkout is blocked while calculating. `deliveryType` is not persisted anywhere.

Two residual risks that could explain a real-world low charge:
1. The distance `useEffect` has no cancellation guard, so rapid delivery → carryout → delivery toggling can let an older in-flight result land last.
2. Because of (C), whatever the client holds at submit time is charged with no server check — this is the plausible mechanism behind the report, not a dedicated carryout bug.

## Cross-cutting

- No react-query caching on these screens; all are manual fetch + realtime. Mobile and web share the same backend and query paths, so no native cache divergence.
- Only `VendorDetail` subscribes to realtime for availability. WhatsApp and Assisted Order are one-shot fetches with no invalidation.
- The offline POS IndexedDB cache is a separate, intentional store and is not a customer-facing menu source.

---

## Prioritized correction plan (not implemented)

1. **Server-authoritative pricing (Critical).** Move order creation behind an edge function that recomputes distance, base/per-km tiers, surge and weather from `platform_settings`, and rejects or corrects client-supplied `delivery_fee`/`total`; tighten the insert policy accordingly.
2. **No silent fallback pricing.** When the distance lookup fails, either retry/queue or refuse checkout instead of charging the flat base fee; log every fallback for review.
3. **Unify the map secret name** so WhatsApp and map-provider paths use the configured key.
4. **One effective-availability rule** in a single server-side function (global flag + hidden + branch override), used by customer app, WhatsApp, wa-session and Assisted Order alike; keep WhatsApp's deliberate "show all" only as a labelled state.
5. **Fix the write surface.** Let cashiers' toggles either work or fail loudly (no silent zero-row updates); cascade combos for branch-level toggles too; retire or backfill the legacy `products.outlet_id` filter.
6. **Product creation robustness.** Block save when photo upload fails (or save then re-attach), clean up orphaned uploads, and require category/branch links.
7. **Carousel visibility.** Approve or auto-approve the 4 vendors' branches, and surface an admin warning when a live vendor has no approved branch.
8. **Add the toggle race guard** in the distance effect.

Suggested order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
