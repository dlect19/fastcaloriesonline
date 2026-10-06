# Browser map key verification (read-only, final)

All checks passed. No edits, deployments, key rotations, Google Maps calls, orders, payments or notifications were made.

| Check | Result |
|---|---|
| GOOGLE_MAPS_BROWSER_KEY exists in project secrets (exact name) | PASS |
| Endpoint from allowed website app.fastcalories.online | PASS: HTTP 200, non-empty key returned (redacted) |
| Endpoint from outside website evil.example.com | PASS: HTTP 403 origin_not_allowed |
| Endpoint with no website and no sign-in | PASS: HTTP 401 authentication_required |
| Endpoint can never fall back to the server key | PASS: it reads only GOOGLE_MAPS_BROWSER_KEY and returns nothing if that is missing |

## Remaining Google Cloud steps before replacing the old server key

- **Browser key restrictions:** allow only websites `https://app.fastcalories.online/*`, `https://*.lovable.app/*`, `https://*.lovableproject.com/*` and `https://localhost/*` (used by the Android app). Allow only the Maps JavaScript API and Places API, since the map picker uses Places search in the browser.
- **Old server key (GOOGLE_MAPS_KEY):** since it was previously served to browsers, replace it. Set the new key's restriction to "None" or server addresses only (never website restrictions), and allow only Distance Matrix, Geocoding, Places and Place Details.
- **Firebase web key:** already public in the app code as normal; optionally restrict it to Firebase APIs and the app websites.
- **Spending guardrails:** set a budget alert and a daily Distance Matrix quota in Google Cloud as a second line of defence.
