# FastCalories Rider – Android build

## How it works
One codebase, two separate Android apps that never touch each other's files:

| | Customer | Rider |
|---|---|---|
| appId | com.customers.fastcalories.app | com.rider.fastcalories.app |
| Name | Fast Calories | FastCalories Rider |
| Web build | `npm run build` → `dist/` | `npm run build:rider` → `dist-rider/` (`VITE_APP_VARIANT=rider`) |
| Android project | `android/` | `android-rider/` |
| Firebase | `android/app/google-services.json` | `android-rider/app/google-services.json` (from `android-rider-config/`) |
| Version | versionCode 14 / 1.0.14 | versionCode 100 / 2.0.0 |
| Signing env | `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD` | `RIDER_KEYSTORE_PATH`, `RIDER_KEYSTORE_PASSWORD`, `RIDER_KEY_ALIAS`, `RIDER_KEY_PASSWORD` |

Why it's safe: `capacitor.config.ts` switches to rider only when `CAP_APP_VARIANT=rider`, and then points
`webDir` at `dist-rider` and `android.path` at `android-rider`. Without the flag everything is the customer app,
the same as before. No files get swapped. `scripts/verify-app-target.mjs` fails the build if either project
has the other app's id, name, Firebase client, scheme or branding, or if the rider app is missing the Geolocation
plugin, has background location or claims https App Links.

The rider build opens at `/rider/auth`, or `/rider/dashboard` when signed in. Every other page, including
deep links, redirects back into `/rider`. Logging out goes back to rider login.
There is no `server.url`, so screens are bundled and the Capacitor bridge is always injected
(diagnostics: `platform=android · bridge=yes · geolocation_plugin=yes`).

## Fresh clone (Mac)
```bash
git clone <your-repo-url> fastcalories && cd fastcalories
npm install
npm run android:rider:debug
# APK: android-rider/app/build/outputs/apk/debug/app-debug.apk
```

## Existing clone
```bash
git pull
npm install
npm run android:rider:debug
```

## Release (AAB)
1. Bump `versionCode` (must be higher than the version on Play) and `versionName` in `android-rider/app/build.gradle`.
2. Run:
```bash
export RIDER_KEYSTORE_PATH=/path/to/rider-upload.jks RIDER_KEYSTORE_PASSWORD=... RIDER_KEY_ALIAS=... RIDER_KEY_PASSWORD=...
npm run android:rider:release
# AAB: android-rider/app/build/outputs/bundle/release/app-release.aab
```
Never commit keystores. `*.jks` and `*.keystore` are in `.gitignore`.

## Android Studio
```bash
npm run cap:sync:rider
npm run cap:open:rider    # opens android-rider/
```
Pick the `app` module, then use Build → Generate Signed Bundle/APK.

## Upgrade rule
An update installs over the existing Rider app only if it has the **same appId and is signed with the same keystore**
as the installed app, and has a higher versionCode. If you use a different key, or the installed version is
higher, uninstall the old Rider app first. Play App Signing builds need the original upload key.

## Customer app (unchanged)
`npm run cap:sync:android`, then `npm run android:build` or `npm run android:release`.

## Branding (rider only)
- Launcher/adaptive icons in `android-rider/app/src/main/res/mipmap-*` come from `resources/rider/icon.png`
  (official green artwork); adaptive foreground is the logo inside the 66/108 safe zone on white.
- Notifications: monochrome `drawable/ic_stat_rider.xml`, accent `#1E9301`, large icon `drawable/ic_rider_large.png`.
- `npm run assets:rider` no longer runs `capacitor-assets generate` (that tool writes into the customer
  `android/` project). The rider icons are committed and survive `cap sync` (sync never touches `res/`).

## Background location (native, active deliveries only)
`RiderTrackingService` (location foreground service, persistent green "FastCalories Rider" notification)
reads fused GPS and uploads **natively** to `publish_rider_location_native` while the app is in the
background or the screen is locked. It is started from the app while visible, only for the rider's
authorised active deliveries, using server-issued per-delivery tokens (4 h, hash-only on the server,
checked against the order's rider/status on every upload). It stops and clears its tokens on delivered,
cancelled, reassigned, offline, logout, kill switch or token expiry. ~1 s while moving, 10 s heartbeat
when still; best-effort, not guaranteed.

Permissions: precise/approximate location ("While using the app" is enough — no "Allow all the time"),
notifications (Android 13+, so the persistent notification is visible), `FOREGROUND_SERVICE_LOCATION`.

### Mac: rider-only build
```bash
git pull
npm install
npm run android:rider:debug          # build:rider → cap sync (CAP_APP_VARIANT=rider) → verify → assembleDebug
adb install -r android-rider/app/build/outputs/apk/debug/app-debug.apk
# release: export RIDER_KEYSTORE_* then: npm run android:rider:release
```
Never run `npx cap sync` / `npm run cap:sync:android` for the rider — those are the customer app.

### Lock-screen test
1. Sign in as a test rider, go Online, accept a test delivery (status assigned/picked_up/on_the_way).
2. Allow location and notifications; confirm the "Sharing your location…" notification appears.
3. Switch to another app, then lock the screen for 2–3 minutes while moving.
4. On the customer's order page (other phone), "Last updated" should keep refreshing.
5. Mark delivered: the notification disappears within ~15 s of the next upload.
Logs: `adb logcat | grep -i -E "RiderTracking|fused"`.

### Limits
Android may still pause GPS: battery saver, OEM "app killers" (Xiaomi/Oppo/Vivo/Huawei/Samsung sleeping
apps) — set the rider app to "Unrestricted"/"No restrictions" battery. Force-stop or swiping the app away on
some OEMs ends the service; it restarts only when the rider reopens the app (Android forbids starting a
location service from the background). Web/PWA and iOS stay foreground-only.
