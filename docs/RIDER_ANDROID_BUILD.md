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
