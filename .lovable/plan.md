# Google API spend: source of the ~22,000 Distance Matrix calls

Read-only diagnosis. Nothing was changed.

## 1. Ranked root cause
1. **Store browsing calls Google once for every nearby branch.**
   - `supabase/functions/get-nearby-vendors/index.ts` runs every time the Home store grid (`VendorGrid`) or the Explore page loads.
   - It loops over every active branch within 1.5 × the sales radius (15 km) and makes one separate Distance Matrix request per branch (lines 355–360). It does this one at a time, with no cache and no logging.
   - It makes a second pass for "online" branches that match the customer's state (lines 424–428).
   - The single-store view does one more call (lines 169–173).
   - It reuses `getGoogleMapsDistance` from `_shared/google-maps.ts`, which writes nothing to `api_usage_log`. That is why only 9 calls were recorded.
2. **The page asks again whenever the phone's location moves.** `useLocationBasedVendors` fetches again whenever latitude, longitude, category, address state or `enabled` change (deps at line 80). Drifting GPS, switching category, or going back to Home each start a full new round of calls. The browser code also retries up to 2 times on 429/5xx (`src/lib/getNearbyVendors.ts`), and each retry runs the whole loop again.
3. **Smaller sources, same key, also unlogged:**
   - `dispatch-order` (line 561): one call per dispatch.
   - `log-delivery-distance`: one call per delivered order.
   - `quote-delivery-fee` / `validate-order-pricing`, via `_shared/delivery-pricing.ts` `roadDistanceKm`: up to 1 + retryCount calls per quote, and again when payment is checked. There were 53 quotes on the busiest day, so this source is small.
   - `calculate-distance` is cached and logged. It accounts for the 9 recorded calls.

## 2. Amplification math
- 23 active branches have coordinates (15 physical, 4 online, 1 both). All have a radius of about 10 km, so the 15 km pre-filter usually keeps nearly all of them for a customer in the service area.
- **One Home or Explore load is about 16 to 20 Distance Matrix requests.** Each request has 1 origin × 1 destination, so request count equals element count.
- 21,972 ÷ ~20 is about 1,100 store-list loads a month, or about **37 a day**.
- That fits the traffic:
  - The web app had 893 visits and 4,867 page views, about 5 per visit, with Home visited often.
  - The Android app adds loads that web analytics doesn't count.
  - Each visit can reload the list several times (GPS moving, changing category, coming back to Home).
- A spike near 1,000 a day is only about 50 store-list loads, for example one tester or admin moving around, or a few riders or vendors opening the customer app.

## 3. App loop or stolen key?
Evidence that this is the app's own traffic:
- Google's count of about 22k sits close to "store-list loads × number of branches". Someone misusing a stolen key wouldn't be limited by our branch count.
- Distance Matrix is called **only from server code**. No browser or Android code calls it: the built Android bundle has no `distancematrix`, and nothing under `src/` does either.
- Browser-side Google use is tiny, which suggests the exposed key isn't being heavily misused in browsers: Maps JavaScript 59 loads, Places 222, Geocoding 239. These numbers match what we recorded (233 reverse geocodes, 124 + 10 Places).

Still open:
- `get-google-maps-key` returns `GOOGLE_MAPS_KEY` to anyone who asks, with no login, and Distance Matrix uses that **same** key (`GOOGLE_MAPS_KEY`, or `GOOGLE_MAPS_API_KEY` as a fallback). Outside misuse can't be ruled out until Google Console's per-key traffic is checked.
- Edge-function request logs for the last 7 days came back empty for these functions. Database timestamps can't be lined up with the daily spikes, because there is no per-call record (`delivery_distance_cache` is empty and get-nearby-vendors doesn't use it).
- Confirm in Google Console: open **APIs & Services → Metrics → Distance Matrix**, filter by the key's credential, and break it down by **API method and response code**. If the spikes line up with times in Nigeria, that points to app traffic. Sudden flat bursts at odd hours point to misuse.

## 4. Affected files
- `supabase/functions/get-nearby-vendors/index.ts`: the main source.
- `supabase/functions/_shared/google-maps.ts` (`getGoogleMapsDistance`): no cache and no logging.
- `supabase/functions/_shared/delivery-pricing.ts` (`roadDistanceKm`, retry loop): no logging.
- `supabase/functions/_shared/map-provider.ts`.
- `supabase/functions/dispatch-order/index.ts` and `supabase/functions/log-delivery-distance/index.ts`.
- `supabase/functions/get-google-maps-key/index.ts`: hands the shared key to anyone.
- `src/hooks/useLocationBasedVendors.ts` and `src/lib/getNearbyVendors.ts`: refetch on location change, plus retries.

## 5. Containment and fix

**Immediate, in Google Console (owner):**
1. Set a **daily quota on Distance Matrix** of about 300 requests a day. Add **budget alerts** at $10, $25 and $40.
2. Create a separate **browser key**:
   - Allow only `app.fastcalories.online`, `fastcalories.online`, `*.lovable.app` and the Android package with its SHA-1.
   - Allow only the Maps JavaScript API and Places.
3. Restrict `GOOGLE_MAPS_KEY` to server APIs only: Distance Matrix (or Routes), Geocoding and Places. Rotate it once the code no longer hands it out.

**Permanent code fix (after approval):**
1. In get-nearby-vendors:
   - Use the straight-line distance for the list, the radius filter and the displayed fee.
   - Compute road distance only for the store the customer actually opens, and at quote time.
   - Where road distance is needed, make **one** batched call for all branches (one origin, up to 25 destinations), cached in `delivery_distance_cache` by rounded coordinates.
2. Have `getGoogleMapsDistance` and `roadDistanceKm` read and write the distance cache and write to `api_usage_log` every time, with function name, route and environment.
3. Client: fetch again only when the location moves more than about 300 m. Drop full-list retries, or retry only on network failure.
4. Require a logged-in user for `get-google-maps-key` and have it return only the restricted browser key. Add login checks to the reverse-geocode, Places and calculate-distance functions.
5. Add a per-function daily cap on Google calls. When the cap is hit, return straight-line distances instead.

**Expected effect:** about 20 calls per store-list load drops to 0, and checkout keeps about 1 call per quote. Distance Matrix should fall from about 22k to under 500 a month.
