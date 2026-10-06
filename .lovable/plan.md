# Server map key verification (read-only)

No edits, deployments, key changes or Google calls were made.

| Check | Result |
|---|---|
| 1. GOOGLE_MAPS_KEY saved | PASS: the name exists. Values are hidden, so it can only be confirmed non-empty by a working backend lookup. |
| 2. GOOGLE_MAPS_BROWSER_KEY still saved | PASS: the name exists, and earlier today the key endpoint returned a non-empty key. |
| 3. Backend lookups use the server key | PASS: road distance, address search, place details and reverse address lookup read GOOGLE_MAPS_KEY in live mode. None of them read the browser key. |
| 4. Key endpoint only returns the browser key | PASS: it reads GOOGLE_MAPS_BROWSER_KEY only, so it cannot return GOOGLE_MAPS_KEY. |
| 5. No publish needed | PASS: the app itself never contains the server key. Backend functions read secrets each time they start, so the new key takes effect within minutes with no redeploy. |

Note: the WhatsApp location helper reads GOOGLE_MAPS_API_KEY first and falls back to GOOGLE_MAPS_KEY. GOOGLE_MAPS_API_KEY is not saved in this project, so WhatsApp also uses the new key.

## Safest way to retire the old key
1. Wait about 24 hours. In Google Cloud, go to APIs and Services > Credentials, open the old key, and check its usage metrics. It should show no requests.
2. If it's still getting requests, check where they come from before you change anything. The old key may still be used by the mobile app or another project.
3. Don't delete the old key yet. Change its API restrictions to an unused API so it stops working right away, but can be switched back if something breaks.
4. Watch real usage for one day: the vendor delivery quote, checkout fee, and address search. The admin Google usage panel should show successful lookups.
5. After that, delete the old key and keep the budget alert and daily Distance Matrix limit in place.
