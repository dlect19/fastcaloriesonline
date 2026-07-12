# Drug Reminder Alarms — Native Setup

The app now uses `@capacitor/local-notifications` to schedule reminders **on the device itself**. Once scheduled they fire even when:
- the app is closed
- the phone is offline
- your server is down

Whenever the user opens the Drug Tracker page, all active reminders are re-synced to the device.

---

## 1) Sync native platforms

After `git pull`:

```bash
npm install
npx cap sync
```

## 2) (Optional) Custom loud alarm sound — Android

Put a `.wav` file at:

```
android/app/src/main/res/raw/alarm.wav
```

Any short loud alarm sound (2–5s) works. The channel `drug_reminders` will use it automatically.

## 3) Android — extra permissions for **exact alarms** (Android 12+)

Open `android/app/src/main/AndroidManifest.xml` and add these permissions inside `<manifest>` (next to your other `<uses-permission>` lines):

```xml
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
<uses-permission android:name="android.permission.USE_EXACT_ALARM" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

You already have `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK` — keep them.

## 4) Android — make the notification behave like an alarm (bypass silent / heads-up)

The `drug_reminders` channel is created with `IMPORTANCE_HIGH` in `src/lib/drugAlarms.ts`. That gives:
- Heads-up popup
- Sound + vibration
- Wakes screen

If you want it to **bypass Do Not Disturb** like a real alarm, users must grant "Alarms & reminders" in Android Settings → Apps → Fast Calories → Alarms & reminders. Android does not let apps toggle this silently.

## 5) iOS — Info.plist

Open `ios/App/App/Info.plist` and add before `</dict>`:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

The first time the user opens the Drug Tracker, iOS prompts for notification permission — handled by the plugin automatically.

### Bypassing Silent mode on iOS (optional)
iOS **only** allows apps to override Silent switch / Focus with **Critical Alerts**, which requires:
1. Requesting the entitlement from Apple: https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement
2. Adding the entitlement to your Xcode project once granted.

Without it, iOS reminders will play their sound only if the phone is not silenced. Most medication apps live with this.

---

## What happens now

- User opens `/drug-tracker` on the app → all active reminders are scheduled locally for the full duration (up to ~400 alarms per sync).
- Each alarm fires with a heads-up notification, sound, and vibration at the exact minute.
- Old scheduled alarms tagged `kind: "drug_reminder"` are cleared before re-scheduling so nothing duplicates.
- Your server-side `process-drug-reminders` cron still runs as a **backup** for web users and to trigger any push logic you have.
