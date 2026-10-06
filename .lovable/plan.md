# Google API spend audit (Sep 2026): findings and containment plan

Nothing was changed while preparing this audit.

## Headline
FastCalories' own records account for only about **US$1.74** of Google charges in September. Separately, about US$0.23 of AI usage went through Lovable AI, which bills Lovable credits, not Google. The remaining ~US$48 comes from traffic the app does not record. The two most likely sources are:
1. A **Google Maps key handed to anyone who asks**. A public function returns it to any caller, with no login.
2. **Map pages loading in the browser**, where every map load and every address-search keystroke is billed directly by Google and never logged.

The exact split can only be confirmed in Google Cloud Billing: Reports, grouped by SKU and by API key.

## Evidence (2026-09-01 to 2026-09-30)
| Source | Recorded calls | Recorded cost |
|---|---|---|
| Server reverse geocode | 233 | $1.17 |
| Server Places Autocomplete | 124 | $0.35 |
| Server Place Details | 10 | $0.17 |
| Server Distance Matrix | 9 | $0.05 |
| WhatsApp AI chat (Lovable AI, gemini-3.8-flash; 474k input / 11k output tokens) | 69 runs, 2 phones | $0.19 (Lovable, not Google) |
| WhatsApp voice transcription (Lovable AI) | 49 | $0.04 (Lovable, not Google) |
| Browser map loads, browser Places, direct Gemini fallback | **not recorded** | unknown |

Web traffic was 893 visits and 4,867 page views, about 19% from the US. Usage from the Android app is not included in these figures. With traffic this small, normal map use alone is unlikely to cost about $48 (see the rough estimate below). That points to either key misuse or app traffic that isn't being counted.

## Ranked root causes
1. **The Maps key is exposed to the public.** `supabase/functions/get-google-maps-key/index.ts` returns `GOOGLE_MAPS_KEY` to any caller: no login check, `verify_jwt=false`, CORS open to all. The same key is used on the server for Geocoding, Distance Matrix and Places. Unless Google Console restricts it by referrer, anyone who fetches it can run billable Maps calls on the account, and none of them would show up in our logs. **This is the most likely cause.**
2. **Browser maps are untracked.** These pages load the Maps JavaScript API with that key, using `libraries=places`:
   - `src/components/shared/MapLocationPicker.tsx` (used in checkout/address, vendor store settings, admin coordinate editors, assisted orders)
   - `src/pages/CoverageMap.tsx` (public)
   - `src/pages/admin/AdminCoverageAreas.tsx`

   Each mount costs one Dynamic Maps load (about $7 per 1,000). Each debounced keystroke (300 ms, 3+ characters) costs one Autocomplete request (about $2.83 per 1,000, or per session with a token). Selecting a result costs one Place Details call. The script is injected again on each mount, and each mount creates a new map. Opening the map 3 to 5 times per address edit is plausible. Only CoverageMap and AdminCoverageAreas have no session token. Nothing is logged to `api_usage_log`.
3. **Direct Gemini fallback is untracked.** `_shared/ai-call.ts` (`chatCompletionWithFallback`, plus the native audio and image paths) and `whatsapp-webhook/agent.ts` lines 241–256 call `generativelanguage.googleapis.com` with `GEMINI_API_KEY` whenever Lovable AI returns 402/429/5xx. Billing is by tokens on that key's Google project. These calls don't create a `whatsapp_usage_events` row marked `provider=gemini`, and no fallback events were found in the current logs, which only go back a short way. The functions that use it are estimate-nutrition, estimate-calories-from-image, ai-meal-recommendation, image generation for campaigns and vendor ads, and WhatsApp NLU, agent and voice. Only WhatsApp calls through Lovable AI are recorded. Food scans, recommendations and image generation are not recorded by any path.
4. **Several server Maps calls are not logged.** These call legacy Distance Matrix or Geocoding with `GOOGLE_MAPS_KEY` and write nothing to `api_usage_log`:
   - `_shared/google-maps.ts`, `_shared/map-provider.ts` and `_shared/delivery-pricing.ts` (Distance Matrix; `delivery_distance_cache` exists, but only some paths use it)
   - `get-nearby-vendors` (reverse geocode on browse, not tied to placing an order)
   - `whatsapp-webhook/index.ts` lines 2539 and 2566, and `tools.ts` line 245 (these go through the connector gateway, a separate key)
5. **Open server endpoints.** `google-places-autocomplete`, `google-place-details` and `google-reverse-geocode` don't check for a logged-in user and have no rate limit. Bots could call them, but they are logged, and the logs show low volume.
6. **Low risk:**
   - Firebase/FCM push and Analytics are free.
   - The Firebase web apiKey in `src/lib/firebase.ts` and the keys in `google-services.json` are public by design. They should still be restricted in Console.
   - Weather goes to open-meteo/openweather, which are not Google.
   - The scheduled jobs (store status, unattended orders, dispatch sweep, payouts, WhatsApp alerts) make no Google calls.
   - Rider GPS (`useRiderLocation`) writes to the database only.

## Keys and projects (names only)
- `GOOGLE_MAPS_KEY`: server and browser use, exposed through the public function above.
- `GOOGLE_MAPS_API_KEY`: connector gateway, used by WhatsApp.
- `GEMINI_API_KEY`: direct Google AI Studio or Gemini key, used only as a fallback.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: FCM.
- Firebase web config: project fastcalories-18ba8.
- No OpenRouter or Vertex AI usage was found.
- There is one key per name. Development and test traffic use the same production keys; nothing switches keys by environment.

## What prevents attribution
- Browser Maps loads, Places calls and browser-key usage are not recorded anywhere in the app.
- Direct Gemini fallback calls and non-WhatsApp AI features have no usage rows.
- Distance Matrix, nearby-vendor and WhatsApp geocode calls are not logged in `api_usage_log`.
- `api_usage_log` stores no user, IP or route. Edge logs only go back a short time.

## Immediate containment in Google Console (owner, no code needed)
1. Open **Billing → Reports** for last month. Group by SKU and filter by project, then open **APIs & Services → Credentials** to see usage per key. This shows which of the causes above is real.
2. Create a **separate browser key**:
   - Allow only `app.fastcalories.online`, `fastcalories.online`, `*.lovable.app` and the Android app's package and SHA-1 fingerprint.
   - Allow only the Maps JavaScript API and Places.
3. Restrict `GOOGLE_MAPS_KEY` to **server use only** (IP addresses or no app restriction), and limit it to Geocoding and Distance Matrix (or Routes). Once the new browser key is live, **rotate** the old one, because it has already been given out.
4. Set **daily quotas** on Maps JavaScript (map loads), Places, Geocoding and Distance Matrix. Add **budget alerts** at $10, $25 and $40.
5. Check the `GEMINI_API_KEY` project's usage. Cap it with a quota, or remove the secret if fallback isn't wanted.

## Code changes to make once approved
1. Require a logged-in user for `get-google-maps-key` and have it return only the restricted browser key. Do the same for the Places, Details and reverse-geocode functions.
2. Load the Maps script once per app session and reuse one map instance. Don't create a map until the user opens the picker. Add session tokens in CoverageMap and AdminCoverageAreas.
3. Log every Google call to `api_usage_log`, including user ID, function, route and environment:
   - browser map loads (a lightweight event)
   - Distance Matrix through the cache in every path
   - get-nearby-vendors geocode
   - WhatsApp gateway geocodes
   - every direct Gemini fallback, with token counts
4. Cache reverse-geocode results by rounded coordinates, using the existing distance cache pattern.
5. Add an environment flag so development and test traffic can't use the direct Gemini fallback. Add a daily cap on fallback calls.
6. Show browser and fallback usage in the admin API usage card.

## Technical details
- **SKUs:**
  - Maps JavaScript API: Dynamic Maps, about $7 per 1,000 loads.
  - Places: Autocomplete per request about $2.83 per 1,000; Place Details about $17 per 1,000.
  - Geocoding: about $5 per 1,000.
  - Distance Matrix: about $5 per element.
  - Gemini API (generativelanguage): billed by input and output tokens per model.
  - Google gives a $200 monthly Maps credit only on older billing setups. Check whether it applies.
- **Amplification:**
  - One address edit: 1–3 map loads, plus about 5–15 autocomplete calls, plus 1 details call.
  - One WhatsApp voice note: 1 transcription, plus 1–N agent tool steps, each a model call (~6.9k input tokens per run on average). It goes direct to Google only if Lovable AI fails.
- **Rough estimate at normal use:** about 4.9k web page views with roughly 10% opening a map is about 500 loads (about $3.50). Autocomplete would add a few dollars at most. Reaching ~$48 needs either key abuse, much more Android app traffic, or a fallback burst.
