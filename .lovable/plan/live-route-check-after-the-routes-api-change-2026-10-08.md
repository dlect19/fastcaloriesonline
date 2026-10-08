# Live route check after the Routes API change

## What the records show (read-only, 15:35 UTC)
- The backend runs in **production** mode. The route function uses the production server key **GOOGLE_MAPS_KEY**. It is the only server map key configured: there is no GOOGLE_MAPS_API_KEY and no development key. The browser key is never used for routes.
- There have been 11 signed-in customer route requests today, from 15:26:38 to **15:32:49 UTC**. **All 11 failed.** None has succeeded yet.
- Every failure is the same: Google returned 403 with reason `API_KEY_SERVICE_BLOCKED` on the first (motorcycle) attempt. That means the key's allowed-API list does not include the Routes API.
- None of the failures said the API is disabled ("SERVICE_DISABLED" / "has not been used"). So the Routes API is switched on for the project. What is still blocking it is that key's restriction list.
- The car-route fallback correctly did not run (it only runs for "unsupported travel mode" errors).
- No requests have arrived since 15:32:49. If you changed the setting after that time, it hasn't been tested yet.

## Likely remaining causes (to confirm)
1. Routes API was added to a different key, such as the browser map key, not the server key saved as GOOGLE_MAPS_KEY.
2. The change was saved less than about 5 minutes before 15:32:49. Google can take a few minutes to apply key restriction changes.
3. The key saved in GOOGLE_MAPS_KEY belongs to a different Google Cloud project from the one where the change was made.

## Steps
1. You check in Google Cloud Console that the key saved as GOOGLE_MAPS_KEY lists "Routes API" under its allowed APIs and was saved at least 5 minutes ago.
2. You reload the order page as the customer who owns the order, while the rider is sharing a fresh location. Only that customer can get the route; I won't sign in as anyone else.
3. I re-read the function logs and usage records (read-only) and report the new outcome: success, the same 403, or a new error.
4. Minor optional fix, only if you approve it: a 403 currently uses up one unit of the daily route limit (11 of 300 used today) even though Google doesn't charge for it. The fix would return that unit after a 403 that isn't billed. It is not the cause of the failures.

No files, orders or settings change, and nothing is published, unless you separately approve step 4.
