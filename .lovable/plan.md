
# Smart Delivery Distance Cache + Weather Service

Two things here:
**(A)** Fix the "0 km" display so past distance records are still visible.
**(B)** Build the full cache + smart weather architecture you described.

Given the size of Part B, I'll ship it in **phased milestones** so nothing breaks the live pricing engine. Each phase is safe to publish on its own.

---

## Phase 0 — Distance-Travelled History Fix (small, ship first)

Problem: rider "Distance Travelled" shows `0 km` when the current period has no logs, hiding all previous logs.

Fix:
- Show the rider's lifetime total + this-week + this-month from `rider_distance_logs` even when today = 0.
- Add a small "History" expander listing the last 20 delivered orders with their logged km + date.
- Empty state: "No trips logged yet" only when the rider truly has zero rows.

Files: `src/hooks/useRiderDistanceStats.ts`, `src/pages/rider/RiderEarnings.tsx` (or wherever Distance Travelled is shown — I'll confirm on read).

---

## Phase 1 — Delivery Distance Cache

**New table** `delivery_distance_cache`:
vendor_id, customer_address_id, vendor_lat/lng, customer_lat/lng, google_place_id, distance_km, duration_min, delivery_fee, created_at, updated_at, expires_at.

Unique index on `(vendor_id, customer_address_id)` for fast lookup.

**Lookup flow (edge `calculate-distance`):**
```text
request → look up (vendor_id, address_id) in cache
  hit + not expired → return cached, mark source='cache'
  miss/expired      → call Google → upsert row → return
```

**Auto-invalidation triggers:**
- `addresses` UPDATE of lat/lng → delete matching cache rows.
- `vendors` UPDATE of lat/lng → delete matching cache rows.
- Admin "Delivery pricing rules changed" → button that truncates cache.
- TTL: `expires_at < now()` treated as miss.

**Admin setting:** `distance_cache_ttl_days` (default 30) in `platform_settings`.

Frontend (`useDeliveryFee`) keeps calling the edge function — no client change needed; savings happen server-side.

---

## Phase 2 — Weather Cache + Smart Scheduler

**New table** `weather_cache`: area_key (e.g. rounded lat,lng grid or city), condition, temperature, rain_status, wind_speed, surge_amount, updated_at.

**New edge function** `refresh-weather` (invoked by pg_cron):
1. Read `weather_service_*` settings.
2. Gate checks — abort if all fail:
   - `enable_weather_service = false`
   - "only when riders online" and no online rider
   - "only when active orders" and no active order
   - "only during business hours" and outside window
3. For each active area (derived from online riders + active orders), fetch provider, upsert cache.
4. Log to `weather_api_call_log` (for analytics).

Frontend `useDeliveryFee` stops calling Open-Meteo. Instead reads latest `weather_cache` row for the customer's area. Zero direct calls per order.

**Cron:** pg_cron job at admin-selected frequency (5/10/15/30/60 min).

---

## Phase 3 — Admin Weather Settings UI

New page `AdminWeatherSettings.tsx` under System Settings:
- Enable toggle, provider dropdown, frequency, business hours, gating toggles, "Update now" button, stats (calls today/month, est. cost).

Settings stored in `platform_settings` under `weather_service_*` keys.

---

## Phase 4 — Surge Management UI

Extend existing `platform_settings` surge keys already used in `useDeliveryFee` with an admin panel: rain tiers (light/heavy/storm/flood), peak hours, weekend, holiday, event, manual. No engine change — same keys read by pricing engine.

---

## Phase 5 — Analytics Dashboard Panel

`api_usage_log` table (provider, endpoint, called_at, cost_estimate). Dashboard tile: today/month calls, cache hit rate, est. money saved.

---

## Phase 6 — Provider Abstraction (future ready)

Introduce `_shared/weather-provider.ts` and `_shared/map-provider.ts` interfaces so admin can switch OpenWeather / WeatherAPI / Tomorrow.io and Google / Mapbox / ORS without touching pricing code.

---

## What I need from you before starting

1. **Ship Phase 0 now?** (small, safe, restores your visible distance history.)
2. **Then proceed Phase 1 + 2** in the next turn (cache + smart weather — the biggest cost savers)?
3. **Weather provider to keep** — stay on Open-Meteo (free, no key) as the default, or switch to OpenWeather (needs API key)?
4. **Default cache TTL** — confirm 30 days OK?

Reply "go" and I'll start with Phase 0 + Phase 1 in parallel.
