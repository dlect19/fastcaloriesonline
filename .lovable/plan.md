# Random order sound on iPhone — audit findings and fix plan

Read-only audit. Nothing was changed, no notifications sent.

## Root causes (ranked by likelihood on iPhone)

1. **Every tap can play the order sound (all roles, iPhone only).**
   `src/lib/globalAudio.ts` `unlockAudio()` runs on every `click / touchstart / pointerdown / keydown` anywhere in the app. It "unlocks" audio by calling `play()` on `new-order.mp3` with `volume = 0`, then pausing. On iOS Safari and WKWebView, `HTMLAudioElement.volume` is read-only (always 1), so the real order sound starts audibly on taps until the pause lands. Because it re-runs on every gesture, the user hears fragments of the order sound "randomly" while using the app. This matches iPhone-only, PWA + native, no-order-expected reports. `useRepeatingNotificationSound.unlock()` has the same pattern at full volume.

2. **Any push becomes an order sound (PWA).**
   `public/sw-push.js` posts `PLAY_NOTIFICATION_SOUND` to every open window for every non-CALL push (chat, status updates, promos, broadcasts), and `src/App.tsx` (module-level listener) plays `new-order.mp3` for it. Combined with `renotify: true` and `requireInteraction: true`, a generic push produces both an OS alert and the order sound.

3. **Vendor sounds on unpaid/non-actionable orders.**
   `src/pages/vendor/VendorDashboard.tsx` plays on every `orders` INSERT for the vendor with no check on payment status, status, channel (POS) or outlet. Pending/unpaid orders (which later expire) and POS sales therefore ring. `VendorOrders.tsx` filters by outlet but also rings on raw INSERT before payment is verified.

4. **Rider sounds on offers not meant for them.**
   `src/components/rider/RiderFloatingWidget.tsx` subscribes to all `dispatch_offers` INSERTs (no rider filter) and plays on each; it is mounted separately on RiderDashboard, RiderOrders and RiderSettings, alongside `RiderLayout`'s own repeating sound. The verified-offer path (`useDispatchOffers`) is the only trustworthy source.

5. **Admin bell** plays on every non-POS INSERT, including unpaid orders (admins only; lower impact).

## Things checked and ruled out / minor

- Initial load/reconnect: realtime handlers only fire on live INSERT/UPDATE, so old orders are not replayed as new. Repeating sounds (`startRepeating` in VendorOrders/RiderOrders) do restart on page load when pending items exist — intended, but not dedup'd by ID.
- Native iOS: `useCapacitorPush` foreground listener only logs; VendorLayout only rings for `type=CALL` matching outlet. Native pushes do not route through `PLAY_NOTIFICATION_SOUND`.
- Push subscriptions (production, counts only): 55 rows, 44 users, 54 FCM + 1 web push, 2 iPhone rows; 6 users hold more than one FCM row. Multiple devices per user are plausible; duplicates could cause a doubled OS alert but not the in-app random sound. No per-send notification log table exists to correlate events.

## Affected audience

- All iPhone users with the app open (customer, vendor, rider, admin) — cause 1.
- PWA users receiving any push — cause 2.
- Vendors — cause 3. Riders — cause 4. Admins — cause 5.

## Minimal fix (not implemented)

1. `globalAudio.ts`: unlock only once, using the Web Audio context resume plus a silent generated buffer — never play `new-order.mp3` to unlock. Same for `useRepeatingNotificationSound.unlock()` (only on explicit "Enable sound" tap, and it may play once there intentionally).
2. `sw-push.js` + `App.tsx`: only post a sound message when `data.type` is an explicit order event (`NEW_ORDER` / `CALL`) and include `event_id`/`order_id`; drop the generic `PLAY_NOTIFICATION_SOUND` fallback. Keep the OS notification; use `tag` = event ID and `renotify` only for CALL.
3. Single sound gate `playOrderSoundOnce(eventKey)` in `globalAudio.ts`: dedupes by order/offer ID (in-memory + short localStorage TTL, shared across tabs/components). All callers route through it.
4. Vendor: ring only when an order becomes actionable — paid (or verified cash/carryout rule) and confirmed, channel not POS, matching selected outlet. Remove the separate ring in VendorDashboard (or route via the gate).
5. Rider: remove the unfiltered `dispatch_offers` sound in RiderFloatingWidget; `RiderLayout` + `useDispatchOffers` stay the sole source.
6. Admin bell: ignore unpaid INSERTs; ring on transition to paid, deduped by order ID.
7. Optional: prune stale duplicate FCM rows on token refresh (per user + device), separate follow-up.

## Tests (mock-only)

Tap events never play the order file; generic push posts no sound; same order ID rings once across two listeners; unpaid INSERT silent, paid transition rings once; POS silent; other-outlet silent; rider offer for another rider silent.
