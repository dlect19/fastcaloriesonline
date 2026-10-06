# Browser map key verification (read-only)

## Results

| Check | Result |
|---|---|
| 1. Live map-key endpoint detects GOOGLE_MAPS_BROWSER_KEY | FAIL: the secret is not in project secrets. The endpoint still returns 503 `browser_key_not_configured` |
| 2. Endpoint can only return GOOGLE_MAPS_BROWSER_KEY | PASS: it reads only that one name and never reads GOOGLE_MAPS_KEY or GOOGLE_MAPS_API_KEY |
| 3. Allowed website / outside website / no website | PASS: app.fastcalories.online gets 503 (key not set yet), evil.example.com gets 403 `origin_not_allowed`, and a request with no website and no sign-in gets 401 `authentication_required`. Rate limit is in place (30/min signed-in, 10/min guest) |
| 4. Live site uses the endpoint | PASS: the live code at app.fastcalories.online calls get-google-maps-key. The only key text in the live code is the Firebase web config key, which is normal and public |

No Google Maps calls, edits, deployments, orders, payments or notifications were made.

## Next steps

1. Owner adds the secret in Project Settings -> Secrets with the exact name `GOOGLE_MAPS_BROWSER_KEY`. Current secrets include GOOGLE_MAPS_KEY but no browser key. The name may have been mistyped, or it may have been saved somewhere else.
2. After it is added, re-run the same three non-billable checks. Expected: the allowed website gets 200 with a key (shown redacted), the outside website gets 403, and no website gets 401.

## Google Cloud settings before replacing the old server key

- **Browser key:** allow only websites `https://app.fastcalories.online/*`, `https://*.lovable.app/*`, `https://*.lovableproject.com/*` and `https://localhost/*`, which the Android app uses. Allow only the Maps JavaScript API and Places API, because the map picker uses Places search in the browser.
- **New server key:** do not restrict it by website. Allow only Distance Matrix, Geocoding, Places and Place Details. If possible, restrict by server address. Save it as GOOGLE_MAPS_KEY.
- **Old key:** replace the old server key only after the browser key works on the live site.
- **Firebase key:** restrict it to Firebase APIs and the app websites as well.
- **Spending limits:** set a budget alert and a daily limit for Distance Matrix in Google Cloud.
