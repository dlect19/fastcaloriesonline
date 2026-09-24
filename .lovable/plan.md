# iPhone sound-on-open audit and correction plan

## Read-only findings

Nothing was edited, deployed, sent, or mutated.

### Confirmed startup replay paths

The strongest code-level cause is **state-driven repeaters starting from existing records**, not realtime replay:

- **Admin:** `src/components/admin/AdminNotificationBell.tsx:40,78-100` initializes the previous count to zero, fetches existing pending orders on mount, and treats any pending order created in the prior five minutes as new. It immediately plays at lines 93–95, then the separate `newOrderCount > 0` effect plays again and repeats every 10 seconds at lines 56–76. Visibility resume re-fetches at lines 124–130. This can replay an order created before the app opened.
- **Vendor Orders:** `src/pages/vendor/VendorOrders.tsx:371-380` starts the repeating order sound after the initial fetch whenever any existing pending/confirmed order is present. It does not require a post-readiness INSERT. Its page listener also starts another repeater on INSERT/payment transition. `VendorLayout` independently owns another 8-second repeater and listener (`src/components/vendor/VendorLayout.tsx:33-36,117-148`).
- **Rider:** `src/components/rider/RiderLayout.tsx:68-94` sounds immediately and repeats whenever the initial secure offer fetch returns an existing offer. `RiderAvailableOrders.tsx:64-71` adds a second repeater from the same initial count. `RiderOrders.tsx:144-155` starts on any existing active order; on that page `RiderLayout` and `RiderFloatingWidget` can also be mounted.

Production counts at audit time: no order created in the prior ten minutes, no live dispatch offer, no vendor pending/confirmed order, but three orders matched the rider page's broad "unactioned" statuses. This supports rider startup replay for a rider opening that page; it does not prove which account/device reported the symptom.

### Confirmed iPhone-wide audio defect

`src/lib/globalAudio.ts:53-84,111-118` installs document listeners for every click, touch, pointer, and key event. Each gesture calls `play()` on the real `new-order.mp3` after setting element volume to zero, then pauses it. iOS Safari/WKWebView does not reliably support programmatic media-element volume, so the first interaction after opening can audibly play the order tone. This code is global and therefore affects customer, vendor, rider, and admin pages in both the PWA and iPhone Capacitor shell. It is the only shared path that explains both PWA and native across every role; technically it fires on the first gesture, which can be perceived as app-open playback.

`useRepeatingNotificationSound.unlock()` also plays the real order file, but only from the explicit Enable Sound button; it is not an automatic startup path.

### Push and service-worker findings

- `public/sw-push.js:22-34` turns **every non-CALL web push** into `PLAY_NOTIFICATION_SOUND`; `src/App.tsx:181-188` then plays the order file. A chat/status/promo push can therefore sound like a new order while the PWA is open. It also uses the shared `default` notification tag with `renotify: true`, causing repeat OS alerts for unrelated pushes.
- Notification click handlers only focus/navigate; they do not directly replay audio (`public/sw-push.js:47-68`, `src/hooks/useCapacitorPush.ts:102-113`).
- Service-worker install/update has no sound call. Cached app-shell versions can retain an old bug, but update activation itself cannot generate the sound.
- Realtime does not replay historical INSERT events on subscription. The false startup alarms come from initial query results feeding repeaters, not a realtime snapshot.

### Listener duplication

- `useCapacitorPush()` is mounted globally through app startup and again on Home or every VendorLayout. It adds registration/foreground/action listeners without removing them on cleanup (`src/hooks/useCapacitorPush.ts`). Remounts can accumulate native listeners. The foreground listener currently only logs, so this does not itself play the sound, but it can duplicate token writes/actions.
- Rider `RiderFloatingWidget` listens to all `dispatch_offers` INSERTs without a rider filter and plays immediately (`src/components/rider/RiderFloatingWidget.tsx:35-59`). The same page also uses the secure shared offer store, allowing duplicate or irrelevant rider sounds.
- Vendor Layout + Vendor Orders/Dashboard and Rider Layout + page/widget each own independent sound sources. A single event can start multiple intervals.
- The global service-worker message listener is module-level and added once per loaded page; no notification-history rows are replayed.

### Push-subscription data

Production has 55 subscription rows for 44 users: 54 FCM and 1 web push. Six users have more than one FCM row; two rows identify iPhone user agents. Those rows may represent valid multiple devices or stale tokens. They can duplicate OS deliveries but do not explain deterministic in-app playback on every open. No safe send-event history was found to prove a duplicate delivery for this report.

## Affected audience

- **All iPhone roles:** global real-file audio unlock risk.
- **Admin:** existing recent pending order replay plus broad INSERT alerting.
- **Vendor:** existing pending/confirmed order replay and overlapping layout/page listeners.
- **Rider:** existing offers/active orders and overlapping/unfiltered listeners.
- **Customer PWA:** generic non-order push mapped to order sound; no customer order-query startup repeater was found.

## Minimal safe implementation

1. Replace global media-file unlocking with a one-time Web Audio resume plus generated silent buffer. Never call `new-order.mp3.play()` from generic gestures; retain best-effort resume on visibility without playing audio.
2. Introduce one event-keyed order-sound gate (`role:eventType:order/offer ID`) with in-memory and short session/device dedupe. All legitimate sound callers use it.
3. Add listener-readiness baselines: initial fetch only establishes current IDs/counts and never rings. Ring only for a newly observed actionable ID or an explicit transition into actionable/paid state after readiness.
4. Vendor: one authoritative listener per mounted portal; paid/actionable, non-POS, selected-outlet events only. Existing pending orders remain visible but silent on open. Remove page/layout duplicate repeaters.
5. Rider: use only `get_my_rider_offers` through the shared store; remove the unfiltered FloatingWidget sound. Mark initial offer IDs as seen; only newly added eligible IDs ring. Existing assigned work is visible but silent on open.
6. Admin: seed the baseline from the first fetch; do not compare it with zero. Ring only on a post-readiness actionable event and dedupe by order ID.
7. PWA push: post an in-app sound message only for explicit routed order/offer event types with an event/order ID. Generic pushes still show their normal notification without the order audio; `renotify` only where intentional.
8. Make native push registration process-wide and return/remove all Capacitor listener handles on cleanup. Keep iOS background notification presentation and navigation behavior unchanged.
9. Treat duplicate FCM pruning as a separate, conservative cleanup only after identifying device/token identity; do not delete subscriptions solely because one user has several devices.

## Required mock-only tests

- Opening/resuming each customer/vendor/rider/admin route with existing records is silent.
- First genuine post-readiness paid vendor order, admin actionable order, or eligible rider offer rings once.
- Same event received by realtime + push + refetch + duplicate component mounts still rings once.
- Unpaid, POS, wrong-outlet, wrong-rider, expired and historical records are silent.
- Generic chat/status/promo push never maps to the order sound; valid order push keeps background notification behavior.
- Generic iPhone tap/touch unlock never invokes the order audio file.
- Capacitor listeners are registered once and removed on cleanup; notification tap only navigates.
- Service-worker update and visibility/focus refresh do not replay old events.
