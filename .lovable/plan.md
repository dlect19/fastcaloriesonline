## Goal
Route push notifications to the Android package **`com.customers.fastcalories.app`** under Firebase project `fastcalories-18ba8` (Sender ID `356075693003`), matching the updated `google-services.json` you uploaded.

## Background
FCM delivers messages to **device tokens**, and each token is bound to the package the app was installed under. The backend (`send-push-notification`, `broadcast-notification`) does not need any change — it already sends to whatever FCM tokens are stored in `push_subscriptions`. The fix is on the **Android client side**: the customer app is currently built as `com.fastcalories.customer`, so its tokens are registered against that package. To deliver to `com.customers.fastcalories.app`, the customer build must use that applicationId, register fresh FCM tokens, and ship with the new `google-services.json`.

Your uploaded JSON keeps the old `com.fastcalories.customer` entry and *adds* `com.customers.fastcalories.app`, so both packages remain valid in Firebase — but only the package the APK is built with will actually receive pushes on a given device.

## Plan

### 1. Replace `android/app/google-services.json`
Overwrite with the uploaded file (adds the new `com.customers.fastcalories.app` client; keeps existing rider/vendor/online entries).

### 2. Rename customer Android app package → `com.customers.fastcalories.app`
Files to update:
- `capacitor.config.ts` — change `appId` from `com.fastcalories.app` to `com.customers.fastcalories.app` (current value is stale and inconsistent already).
- `android/app/build.gradle` — `namespace` and `applicationId` → `com.customers.fastcalories.app`.
- `android/app/src/main/AndroidManifest.xml` — update `android:name=".MainActivity"` reference and any `com.fastcalories.customer.*` fully-qualified names.
- `android/app/src/main/assets/capacitor.config.json` — `appId` → `com.customers.fastcalories.app`.
- `android/app/src/main/res/values/strings.xml` — `package_name` and `custom_url_scheme` → `com.customers.fastcalories.app`.
- Move `MainActivity.java` from `android/app/src/main/java/com/fastcalories/customer/` to `android/app/src/main/java/com/customers/fastcalories/app/` and update its `package` declaration.

### 3. Deep linking / OAuth follow-ups (flag for you)
These live outside the repo and must be updated manually in the respective consoles, otherwise Google Sign-In and App Links will break for the renamed app:
- **Google Cloud Console** — add a new Android OAuth client for `com.customers.fastcalories.app` with the APK's SHA-1 fingerprint (the uploaded `google-services.json` shows no oauth_client entries with SHA for this package yet).
- **`.well-known/assetlinks.json`** on `app.fastcalories.online` — add the new package name + SHA-256 alongside the existing entries.
- **Paystack / any webhook callback whitelists** — no change (web-based).

### 4. Rebuild & reinstall
After merging, you must:
```
git pull
npm install
npx cap sync android
npx cap run android   # or rebuild APK via Codemagic
```
Existing installs of `com.fastcalories.customer` will keep getting pushes to the old package until uninstalled. New installs of `com.customers.fastcalories.app` will register fresh FCM tokens into `push_subscriptions` and start receiving notifications immediately.

### 5. Verification
- After install, check `push_subscriptions` for the test user — `endpoint` should start with `fcm://` and a new row should appear post-login.
- Trigger a test from Admin → Broadcast Notification (target: customers) and confirm receipt on the renamed app.

## Out of scope
- No backend / edge function changes (FCM v1 send path is package-agnostic).
- Rider (`com.fastcalories.fastcaloriesrider`), vendor (`com.fastcalories.vendor`), and online (`com.fastcalories.online`) packages are untouched.

Confirm and I'll implement steps 1–2 in the repo; steps 3–5 are manual actions on your side.