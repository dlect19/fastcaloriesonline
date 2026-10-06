# Diagnosis: map fails in the installed mobile app (works on desktop web)

## Findings (from config and code)
- The installed app is **bundled**, not a remote wrapper: the shipped `capacitor.config.json` has no `server.url` (it is only set when `CAP_SERVER_URL` is passed at build time). Pages load from the app's own local origin.
- No `hostname`, `androidScheme` or `iosScheme` override, so Capacitor defaults apply:
  - **Android:** page origin `https://localhost`; Google receives referrer `https://localhost/...`
  - **iOS:** page origin `capacitor://localhost`; Google receives referrer `capacitor://localhost/...` (or none)
- Our key service (`isAllowedOrigin`) already accepts `https://localhost`, `http://localhost` and `capacitor://localhost`, so the app does get the browser key. The grey Google error comes from Google rejecting the referrer on the key.

## Root cause
- **Android:** the browser key's website list doesn't include `https://localhost/*` (or the change hasn't taken effect yet). Desktop works because `app.fastcalories.online` is on the list. The error should be RefererNotAllowedMapError.
- **iOS:** Google's website restrictions only accept http/https referrers, so `capacitor://localhost` can never match. The map can't load on iOS with a website-restricted key unless the app's local address changes.

## Google Cloud settings (browser key, keep it restricted)
- Websites: `https://app.fastcalories.online/*`, `https://*.lovable.app/*`, `https://*.lovableproject.com/*`, `https://localhost/*`
- APIs: Maps JavaScript API and Places API only.
- Do not use an unrestricted key and do not add wildcards like `*`.

## Minimal fix options (need approval, none applied)
1. **Recommended, small config change:** set `server.iosScheme: 'https'` and `server.hostname: 'localhost'` in capacitor.config.ts so iOS also uses `https://localhost`. One referrer then covers both platforms. Requires a new iOS build. Saved local data (login, storage) on iOS moves to the new address, so users may need to sign in again once.
2. **Safer long-term alternative:** a separate mobile-only Maps key with no website restriction, limited to the Maps JavaScript API with a daily quota cap, sent only to requests from the native app. Website restrictions on `localhost` can be faked by anyone running a local page, so a strict daily quota is the real safeguard either way.

## Verify after the owner's change
Open the map on Android after about 5 minutes. If it still fails, use Chrome remote debugging (needs a debug build, since WebView debugging is off in release) to read the exact Google error code.
