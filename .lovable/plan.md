# Read-only rider diagnosis — FC-260917-6011

## Conclusion

**Confirmed discovery defect: the new payment-verification lookup is incompatible with rider row-level access.** Ordinary riders can read their own dispatch offers, but cannot read the linked dispatch request. Even if request access were added alone, the linked order is `searching_for_rider`, which the existing unassigned-order policy does not expose to riders. `useDispatchOffers` therefore discards the offer despite the order being paid.

**A second confirmed blocker now applies: all six current offers expired at 15:18:30 UTC.** At the investigation snapshot (approximately 15:24–15:28 UTC, 17 September), the initial offer query excludes them before reaching payment verification. Their stored status remains `pending`; that does not override expiry.

Classification: **RLS/client payment-gate integration regression, compounded by expired dispatch offers.** Dispatch generation itself succeeded. A stale build or missed realtime event is not required to explain this result.

No code, settings, production rows, assignments, offers, orders, payments or messages were changed. No rider app was opened for testing, because its location tracking can write production rows. WhatsApp/cost work remains paused.

## Order evidence

Only **one unresolved paid delivery order created in the last 24 hours** was found:

| Field | Observed value |
|---|---|
| Order | **FC-260917-6011** |
| Order ID | `0ecc32aa-5c8c-4db3-bfff-e69a4af4ccf7` |
| Customer | Michael O. O.; user `84d7b883…8788` |
| Created | 17 September, 14:31:58 UTC |
| Payment | `paid`, wallet; reference `WP-BATCH-1789655521080` |
| State | `searching_for_rider`, delivery, no rider assigned |
| Channel / environment | `online` / `production` |
| Vendor | Taste Affairs; `950d092d…4f2c` |
| Outlet | `efa9b94e…3a5d`, database label “Main Outlet”; dispatch display “Taste Affairs – Alimosho” |
| Pickup | 1b Camp Davis Road Sabo Ayobo; 6.591895, 3.225997 |
| Destination | 4 Ifesowapo Avenue, Idimu; 6.5780008, 3.2257292 |
| Total / delivery fee | ₦6,315 / ₦1,325 |
| Delivery quote | `2f3729a0…13b6`; Google road distance 2.5 km, base ₦1,025 + weather ₦300 |

The quote was created at 14:31:37, expired at 14:46:37 and is consumed by this order. The order was created within that interval. This diagnosis checks stored paid state/reference, not a new financial reconciliation.

### Dispatch timeline

- **15:14:58:** logs confirm six offers created; one rider excluded by the concurrent-order limit.
- **15:17:28:** another dispatch run deleted the previous request and its offers.
- **15:17:30:** replacement request `fe7927ac…4ed5` and six offers created successfully. Logs report one push sent, zero failed; that is not proof that any particular device received or opened it.
- Request: `pending`, initial radius 5 km, retry count 0, maximum retries 3, no accepted rider/time.
- All six offers: `pending`, no response timestamp, expiry **15:18:30**. No successful active claim exists.
- Earlier attempts cannot be reconstructed completely from current rows because retry deletes them. The available logs prove at least these two rounds.
- No recent `accept-dispatch` logs were returned. This does not prove that no historical attempt occurred outside log retention.

## Affected riders

All six offered riders currently have online, verified, email-verified and NIN-verified flags, locations, matching offer user/profile IDs, rider roles and rider wallets. None has an active order under the status set checked during the initial rider comparison.

| Rider | User ID | Offered pickup distance | Important observation |
|---|---|---:|---|
| **Oluwapelumi Michael A.** | `c90ff683…4ca8` | 0.14 km | Most likely reporting rider: signed in 15:16:45, profile updated 15:18:36; ordinary rider, not admin |
| Tijani H. | `1c85dbc5…c83e` | 2.43 km | Ordinary rider |
| Afolabi B. | `56c79156…bffe` | 3.02 km | Also an **admin**; can pass the linked-row access check, unlike ordinary riders |
| Afolabi B. | `99b113ed…6852` | 3.06 km | Delivery-company rider; ordinary rider access |
| Moyosore I. | `196153d0…8e18` | 3.09 km | Ordinary rider |
| Chinedu A. | `edb52166…6ff4` | 3.99 km | No vehicle type stored; generator still included him |

The reporting device/account was not identified by the user, so the likely rider identification is **not certain**. Both the likely rider and admin rider have no auth ban recorded. The likely rider's rider-wallet balance is ₦2,045; wallet balance is not a discovery condition.

The likely rider's latest coordinates are 6.5936506, 3.2273867; work radius 10 km, bicycle. His profile update is approximately six minutes old at the first snapshot, but `updated_at` is not a dedicated GPS heartbeat. Several other online profiles were last updated months ago. Dispatch does not test freshness, so these old online flags may overstate genuinely reachable supply.

## Exact exclusion chain

### 1. Server generation — passed for these six riders

`supabase/functions/dispatch-order/index.ts`:
- Lines 363–409: fetch order; block unpaid online/WhatsApp non-cash orders, Carryout, or already-assigned orders. This paid, delivery, unassigned order passes.
- Lines 266–272: require online + verified + email verified + NIN verified.
- Lines 283–318: vehicle distance, tier, location, active-order capacity and pickup radius checks.
- Search is explicitly **all tiers** (lines 499–503), not only affiliated riders.
- Live settings: initial radius 5 km, acceptance 60 seconds, maximum concurrent orders 2. Bicycle configured dispatch radius 10 km and maximum delivery distance 10 km; motorcycle 30 km/30 km. Global 5 km still limits this round.
- No wallet, active-shift, GPS-age, auth-ban or rider environment/channel check appears in this candidate loop. These are not the cause of these six offers disappearing.
- Capacity count uses `assigned`, `picked_up`, `preparing`, `confirmed`, `searching_for_rider`; it omits `on_the_way`. That separate inconsistency is not needed to explain this incident.

### 2. Initial client query — **first exclusion now**

`src/hooks/useDispatchOffers.ts:46–52` directly queries the database API, not `find-nearby-riders` or an available-orders RPC:

`dispatch_offers` where `rider_user_id = signed-in user`, `status = pending`, **`expires_at > device time`**.

At the snapshot, every offer fails expiry. Device clock skew could also affect this filter, but no device clock evidence was supplied.

### 3. Linked payment lookup — **confirmed defect during an unexpired offer window**

`src/hooks/useDispatchOffers.ts:63–79` then reads:

`dispatch_requests.select('id, orders(payment_status, channel)')`

It allows only request IDs with a visible linked paid order (or POS/assisted channel). Missing request/order data is deliberately rejected; errors also clear all offers (lines 82–84).

Live database evidence:
- Row-level security is enabled on all three tables.
- Authenticated SELECT grants exist on all three: **not a missing table grant**.
- `dispatch_offers`: riders can SELECT their own offers.
- `dispatch_requests`: SELECT is allowed to admins and vendor owners; **no rider SELECT policy exists**.
- `orders`: ordinary riders can SELECT assigned-to-self orders or **unassigned `ready_for_pickup`** orders; this one is **`searching_for_rider`** and unassigned.

For the likely rider, who is neither admin nor owner of this vendor, the request lookup cannot return the needed row. The hook builds an empty allowed-ID set and removes the paid offer. This can be a successful HTTP response containing no rows, not necessarily a logged error. Adding request access alone would still leave the nested order invisible.

This is the exact fail-closed linked-order gap introduced by the added payment-check path. The payment check should be preserved; its authorized data path needs correction.

## Realtime and “Available” meaning

- `dispatch_offers`, `dispatch_requests` and `orders` are all published to realtime.
- `useDispatchOffers.ts:186–226` subscribes to the signed-in rider's offer events. INSERT/UPDATE re-fetch through the same failing payment lookup; DELETE removes the offer.
- A five-second timer only removes expired offers. It does **not** poll for new offers.
- No focus/resume refresh or linked-order/request subscription exists in this hook. Manual refresh exists on the page. Reconnection/PWA/device delivery remains unverified.
- `RiderBottomNav.tsx:58` uses **“Available” as a navigation label**, not proof of an available job. The status switch says Online/Offline and reflects `is_online`.
- Its count query reads offers without the linked-payment check (`RiderBottomNav.tsx:27–34`). Thus it can count an offer the page rejects. It also has no expiry timer, so a badge can remain stale until another event/refetch.
- `RiderAvailableOrders.tsx` additionally requires online status and a stored latitude; the likely rider satisfies both. It displays “No delivery requests” when the filtered offer list is empty.

## Other confirmed findings and scope

1. **Five ordinary recipients share the access defect.** The sixth recipient has an admin role, so the admin policies bypass it; however, that rider also has no unexpired offer now. This explains why admin-account testing may not expose the ordinary-rider regression.
2. The all-age unresolved paid-delivery query found **three additional February orders**, all assigned to rider `4eb458d9…de4c`: FC-260220-1128, FC-260219-4287, FC-260219-6263. That rider has three active assigned orders against a limit of two, consistent with the one capacity exclusion in logs. Do not clear historical orders automatically.
3. No additional unresolved paid delivery order created within the inspected 24 hours was found. Other three paid deliveries in that interval were delivered.
4. **Destination-coordinate gap:** this order has inline delivery coordinates but no saved `delivery_address_id`. Dispatch reads only the joined saved address (`dispatch-order:484–493`), so its request has null destination coordinates and logs 0.0 km delivery distance despite the consumed quote showing 2.5 km. This is a separate distance/ETA/payout-risk defect, **not the visibility blocker**.
5. Listed cron jobs contain no dispatch-expiry/retry job. The inspected vendor page offers retry controls; current request retry count remains zero. No user trigger was listed on dispatch requests/offers. This evidence does not exclude an external scheduler, but no server-side automatic retry was demonstrated.

## Safest corrective action — recommendation only

1. Provide an authenticated, narrowly scoped server query/RPC for **the caller's own offers**, joining paid-order state securely and returning only necessary fields. Alternatively use carefully scoped policies for both request and order access. Do not expose all orders, disable RLS or remove payment verification.
2. Make the page, badge and notification eligibility use the same result; distinguish lookup failure from a genuine empty list. Add safe resume/refetch handling and expiry-aware counts.
3. Verify with isolated fixtures for an ordinary rider, admin rider, unpaid order, wrong rider and expired offer. An admin-only test is insufficient.
4. Only after the discovery fix is verified and separately authorized, restart dispatch for the still-paid, still-unassigned order. Retrying now alone would produce another short-lived set of hidden offers for ordinary riders.
5. Separately address inline destination-coordinate fallback and durable retry/expiry handling; review the three old assigned orders with their owner before any corrective action.

**None of these actions was performed. This report does not authorize production changes.**

## Remaining evidence needed

To tie the confirmed defect to the exact reporting screen, the smallest additional evidence is **which rider account/device is affected**, plus its app version and a captured read response for the linked request lookup during an already-existing unexpired offer. Do not create an offer merely to test this read-only diagnosis.

Ranked explanations: (1) confirmed linked-row access defect for ordinary riders; (2) confirmed expiry for all current recipients; (3) account-specific capacity if the reporting account is `4eb458d9…de4c`; (4) stale app/realtime/background or device-clock problems, presently unproven. No browser request evidence or historical device telemetry was available to determine exactly what ran on that handset.
