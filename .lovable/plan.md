# Diagnosis: FC-260929-9614 rider not notified (read-only findings + fix plan)

## What production shows
| Round (UTC) | Offers | Offered riders with any push row | Request status | Offer status |
|---|---|---|---|---|
| 11:13 (r0) | 5 | 1 | expired | expired |
| 11:15 (r1) | 12 | 1 | expired | expired |
| 11:17 (r2) | 13 | 2 | expired | expired |
| 11:19 (r3) | 13 | 2 | **pending (stuck, expired 11:20)** | **superseded** |

Platform-wide: 16 riders online, only 3 rider accounts have any push subscription (70 rows total, mostly non-riders).

## Root causes
1. **Expiry sweep is broken (blocks all retries).** `dispatch_sweep_expiry` (DB function called by `supabase/functions/dispatch-retry-sweep/index.ts`) sets exhausted rounds to `status='failed'`, but `dispatch_requests_status_check` only allows `pending, accepted, expired, cancelled, no_riders`. Every minute since 11:21 the log shows `23514 violates check constraint dispatch_requests_status_check` on request `9879b779…`. The whole sweep transaction rolls back, so round r3 stays `pending` forever.
2. **Stuck "live" round swallows new searches.** Subsequent Search Rider calls (logs 11:25, 11:26) run in `dispatch-order`: they first mark previous offers `superseded` ("Superseded 4 previous dispatch request(s)"), then the insert hits the one-live-round index, and the conflict handler returns the stuck round ("Live dispatch round already exists — returning it"). Result: rider sees zero offers (all superseded/expired), no new offers are created and **no push is sent** on that path. Order sits in `searching_for_rider`.
3. **Push coverage is thin, not misrouted.** `dispatch-order` does invoke `send-push-notification` automatically after offer insert, targeting all eligible rider user IDs. The sender only delivers to riders with a `push_subscriptions` row: 11 of 13 riders in r3 had none, so they could only see offers by having the app open (realtime/20s poll). Platform selection is correct (`subscription_type='fcm'` -> FCM v1, else Web Push); 404/410 endpoints are deleted. Gaps: FCM `UNREGISTERED`/400 `INVALID_ARGUMENT` are not treated as stale, and riders without tokens are not reported.
4. **60-second TTL is tight.** With no push, a backgrounded rider will usually miss a 60s offer; pruning is by server clock so offers aren't hidden early, only genuinely expired.
5. **No regression from sound isolation.** `public/sw-push.js` still shows OS notifications for all pushes; rider portal remains an authorized sound scope. Push payload uses `tag: 'dispatch-offer'` without `type: 'DISPATCH_OFFER'`/`offer_id`, so in-app order sound is not triggered by the push (notification still shows) — a minor gap, not the cause.

## Minimal safe correction (additive, needs approval)
1. Migration: replace `dispatch_sweep_expiry` so exhausted rounds become `no_riders` (allowed value) instead of `failed`; no constraint weakening. Verify sweep succeeds and r3 closes.
2. `dispatch-order`: run the supersede step only after confirming no live round exists (or inside the same guarded path), so the conflict path never orphans offers; if the live round is past `expires_at`, expire it and create a fresh round (still one live round, idempotent).
3. `send-push-notification`: treat FCM `UNREGISTERED`/`INVALID_ARGUMENT` as stale and delete; return `no_subscription_user_ids` count; add `type: 'DISPATCH_OFFER'` + `offer_id` in dispatch payload so rider sound gate works.
4. Rider app: show a "Notifications off on this device" banner when the rider has no push subscription, prompting enable (no auto-send).
5. Optional (decision): raise offer TTL to 90s to match native heads-up timeout.
6. Tests for sweep status values, conflict path not superseding, stale-token cleanup. No live dispatch in tests. After deploy, the vendor presses Search Rider for FC-260929-9614 once (not done by me).

## Technical notes
Files: `supabase/functions/dispatch-order/index.ts` (supersede ~l.449, conflict ~l.600–630, push ~l.680), `supabase/functions/dispatch-retry-sweep/index.ts`, DB `public.dispatch_sweep_expiry`, `supabase/functions/send-push-notification/index.ts` (l.303–356), `public/sw-push.js`.
