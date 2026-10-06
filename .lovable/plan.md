# Diagnosis: "This page didn't load Google Maps correctly" in Pin Your Exact Location

## What was checked
- Preview telemetry for this message has no console or network entries for Google Maps, so the exact error code (e.g. RefererNotAllowedMapError) is not captured and cannot be proven from here.
- The map loads with `https://maps.googleapis.com/maps/api/js?key=<browser key>&libraries=places` (MapLocationPicker). Key comes from get-google-maps-key, which returned 200 with a key earlier, so the key is delivered. The failure happens inside Google's check of that key.
- Google's grey "Something went wrong" box only appears after the script loads and Google rejects the key/referrer/project. A missing key or blocked endpoint would show our own app error, not this box.

## Where the preview runs
The editor preview is served from `https://id-preview--35bd9daf-0ce9-4743-a361-ec2d45be6932.lovable.app` (inside an iframe on lovable.dev). Some preview views use `https://35bd9daf-0ce9-4743-a361-ec2d45be6932.lovableproject.com`. Google checks the page that loads the script (the iframe), not lovable.dev.

## Ranked likely causes
1. **RefererNotAllowedMapError (most likely):** the allowed websites list on the browser key lacks the preview address or uses the wrong pattern.
2. **ApiNotActivatedMapError:** Maps JavaScript API is not turned on in the key's Google Cloud project, or the key's API list leaves it out.
3. **Places library blocked:** `libraries=places` needs **Places API** (the older one) turned on and allowed on the key. Allowing only "Places API (New)" can fail.
4. **BillingNotEnabledMapError:** no billing account is linked to that Google Cloud project.
5. **InvalidKeyMapError:** wrong value pasted (extra spaces, or a key from a different project).

## Exact Google Cloud settings (browser key)
- Application restriction: Websites. Add all of these:
  - `https://app.fastcalories.online/*`
  - `https://*.lovable.app/*`
  - `https://*.lovableproject.com/*`
  - `https://localhost/*` (Android app)
- API restrictions: Maps JavaScript API and Places API (and Places API (New) if listed).
- APIs and Services > Library: turn on Maps JavaScript API and Places API in the **same project** as the key.
- Billing: link an active billing account to that project.
- Changes can take up to 5 minutes to apply.

## How to get the exact code (no code change)
Open the preview, press F12 > Console, open the modal and read the line starting with "Google Maps JavaScript API error: ...". Or open https://app.fastcalories.online and try the same modal. If production works and the preview fails, cause 1 is confirmed for the preview address.

## Optional follow-up (needs approval)
Show Google's error code inside the map box (via `gm_authFailure`) so admins see it without opening the console. No billing impact.
