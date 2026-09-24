# Read-only diagnosis: order sound on every button press

## Confirmed root cause

The affected installed clients are executing the **old global audio-unlock routine**, not the corrected production bundle currently returned to a clean browser.

The obsolete routine registers capturing listeners on every `click`, `touchstart`, and `keydown`, then calls `play()` on `/sounds/new-order.mp3` after setting the media element volume to zero. iOS Safari/WKWebView does not reliably honor programmatic media-element volume, so the real order tone is audible. If that `play()` promise does not complete successfully, the `GT`/unlocked flag remains false and the listener is not removed, causing the sound on every subsequent button press. The Scan Food button is only the visible trigger; its handler does not contain notification-audio logic.

## Evidence

- **Current source is corrected:** `src/lib/globalAudio.ts:54-76` resumes a Web Audio context and starts a generated one-sample silent buffer. It never invokes `HTMLAudioElement.play()` to unlock.
- **Current live network bundle is corrected:** `https://app.fastcalories.online/assets/index-kA6Ha7Pz.js` contains the same generated-silent-buffer implementation. Its SHA-256 is `b03d56bce275cb0136a2ce6fc091dd75cb65a0bfede5c3b708e2c02252b05585`.
- **Clean-browser runtime is silent:** instrumenting `HTMLMediaElement.play()` and Web Audio on a harmless public Sign In click recorded only a 1-sample silent buffer and the silent keep-alive buffer. There was no media-element play of `new-order.mp3`.
- **A stale packaged bundle contains the exact bug:** `android/app/src/main/assets/public/assets/index-5cYnoxRD.js` contains `new Audio('/sounds/new-order.mp3')`, `volume=0`, `play()`, then `pause()`, plus capturing global gesture listeners. `android/app/src/main/assets/public/index.html` points directly to that stale asset.
- **The stale asset is not the current website asset:** requests for `index-5cYnoxRD.js` on the live domain return 404; the current page points to `index-kA6Ha7Pz.js`.
- **Installed-web caching can retain the old execution context:** the app worker precaches hashed JavaScript and uses `skipWaiting`/`clientsClaim`, but an already open standalone PWA can continue running its loaded old bundle until fully terminated and restarted. Old worker caches can also serve the old shell while offline.
- **The native shell has two possible paths:** its checked-in packaged web files are stale and buggy, while its packaged Capacitor configuration points to `https://app.fastcalories.online`. A build or fallback that uses embedded files runs the old routine; a remote-loaded session can retain the same stale worker/client state as the PWA.
- **The camera path is unrelated:** `src/components/home/ScanFoodBanner.tsx:10-12` only opens the camera dialog; `CameraCalorieTracker.tsx:53-63` plays the camera `<video>`, not the order MP3.
- **The repeating-sound hook is not the global click source in current source:** `src/hooks/useRepeatingNotificationSound.ts:73-80` calls the corrected silent `unlockAudio()`. Its real audio `playOnce()` is separate and only used by notification repeat flows.

## Why the previous deployment did not stop it

The source and newly published website were fixed, but the deployed update did not invalidate every already-running installed client, and the native packaged assets were not replaced by a new signed iPhone build. Therefore the user's PWA/WKWebView can continue executing the pre-fix global listener even though a fresh browser request receives corrected code.

## Affected scope

- A freshly opened ordinary browser session loading `index-kA6Ha7Pz.js`: not reproducible.
- An installed PWA still running the pre-fix client/worker cache: affected.
- A native build or fallback using stale packaged web assets: affected.
- Any role is affected because the obsolete listener is global and loads before role-specific pages.

## Narrow safe correction design

1. Remove the global gesture listeners entirely. Unlock Web Audio only from the explicit Enable Sound control; legitimate notification playback remains event-gated.
2. Keep generated silent Web Audio only; never create or play the order MP3 in any unlock path.
3. Add a startup build assertion that fails if any generated Capacitor asset contains the legacy `volume=0` + order-audio `play()` signature.
4. Publish a new hashed website bundle and worker version, then require the old worker/client to terminate before activation; provide an in-app update/reload path rather than relying on repeated manual opens.
5. Run Capacitor sync and produce a new signed iOS build so embedded/fallback files contain the corrected bundle. Merely publishing the website cannot replace files packaged inside an installed native app.
6. Verify on a clean PWA and the rebuilt iOS app by instrumenting media playback: generic buttons, Scan Food, focus/resume, and worker update must produce zero `new-order.mp3` play calls; a genuine keyed order event must still play once.

## Required tests

- Generic `click`, `touchstart`, `pointerdown`, and `keydown` never invoke order-media playback.
- Scan Food opens the camera without order audio.
- Installed-app update and focus/resume remain silent.
- Generated web and Capacitor bundles contain no legacy muted-media unlock signature.
- Explicit Enable Sound silently resumes Web Audio.
- A genuine event-keyed order/offer alert still plays once and duplicate delivery remains silent.

No code, database, configuration, deployment, push, order, or notification was changed during this diagnosis.
