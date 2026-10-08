# Read-only inspection: rebuilding the Rider Android app

## Findings

### 1) One codebase, one app — no separate rider repo
This repository is a single codebase. Customer, vendor and rider are routes inside the same app (`/rider/...` routes, rider UI mounted in `RiderLayout`). There is exactly one Capacitor config (`capacitor.config.ts`) and one Android module (`android/app`). There is **no separate rider repository, rider Capacitor config, or rider Android module** in this project.

### 2) Rider-specific build configuration
- There is **no rider-specific build script or env var**. `package.json` scripts are shared: `build`, `cap:sync:android`, `android:build`, `android:release`.
- `capacitor.config.ts`: `appId: 'com.customers.fastcalories.app'`, `appName: 'Fast Calories'`, `webDir: 'dist'`. Optional `CAP_SERVER_URL` env var points the app at a remote URL; unset = bundled `dist` assets (current state — no `server.url` in `android/app/src/main/assets/capacitor.config.json`).
- Android module: `android/app` (`applicationId "com.customers.fastcalories.app"`, `minSdk 24`, `targetSdk 35`).
- `android-rider-config/google-services.json` is only a reference copy of Firebase config; it contains a `com.rider.fastcalories.app` Firebase entry, but no Android module in this repo uses that package name. The rider "app" is the same installed app; the rider simply signs in and uses the rider portal.
- `resources/rider/` holds rider branding masters; `npm run assets:rider` swaps icon/splash before generating — cosmetic only, does not change appId or behavior.

### 3) What `npm run build && npx cap sync android` builds
It builds the **shared app** (customer + vendor + rider routes together) into `dist/` and syncs it into `android/app`. There is no way to build "rider only" — and none is needed: the live-tracking fix is in the shared frontend, and the installed app the rider uses is this same binary.

### 4) Safe commands on a Mac (rider-relevant rebuild)
```bash
git clone <your-repo-url> fastcalories && cd fastcalories   # or: cd existing && git pull
git checkout main && git pull origin main                   # main HEAD is 8d99f7ed
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug                       # debug APK
# or release (needs keystore env vars, see below):
cd android && ./gradlew assembleRelease
```
Or use Android Studio: `npx cap open android`, then Build > Build APK / Run on the rider's device.

### 5) Versioning and signing
- Version lives in `android/app/build.gradle`: `versionCode 14`, `versionName "1.0.14"` (shared, not rider-specific). Bump these before a new release build so the phone/store treats it as an update.
- Release signing uses env vars read in `build.gradle`: `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD` (same keystore as the published app — required, or the existing install cannot be updated in place). Debug builds need no signing setup.

### 6) Live-tracking commit 8d99f7e
`8d99f7ed "Fixed Capacitor native detect"` is the HEAD of `main` (and of `origin/main`). Building from `main` includes it. Verify after pulling with: `git log --oneline -1` → should print `8d99f7ed`.

## Conclusion
"Rebuild the rider app" = rebuild this repo's single Android app from `main` and install it on the rider's phone. No rider-only build exists or is required.

## Technical details
- Key files: `package.json` (scripts), `capacitor.config.ts`, `android/app/build.gradle`, `android/app/src/main/assets/capacitor.config.json`, `android-rider-config/google-services.json`, `docs/MOBILE_BUILD_QUICKSTART.md`, `docs/CODEMAGIC_SETUP.md`.
- No edits, builds, deploys or data changes were made — inspection only.
