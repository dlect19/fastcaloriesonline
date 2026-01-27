
Goal
- Fix earnings not showing for riders/vendors (Earnings tab shows ₦0 even when dashboards show activity).
- Restore repeating “new order” notification sound every 10 seconds (vendor + rider) until the user takes action (accept/claim/update status).
- Fix “www.google.com is blocked” when opening map links, and provide a reliable in-app way to view/open addresses.

What I found (root causes)
1) Earnings are ₦0 because the “ledger” tables are not being written
- In the test database, there are:
  - 0 rows in wallet_transactions
  - All wallets balances are still 0 (both normal and test_* columns)
- Some orders are marked paid, but the function paystack-verify-payment currently only marks the order as paid; it does not credit platform/vendor/rider wallets or insert wallet_transactions.
- The system currently relies on paystack-webhook (external callback) to credit wallets, but there are no logs and (in practice) it’s not firing for your project flow right now, so earnings never get recorded.
- Additionally, riders are usually assigned after payment; even if a payment webhook ran, the rider_id is typically NULL at payment time, so rider earnings would still not be credited unless we also credit when rider_id gets assigned.

2) Notification sound “not sounding again”
- The repeating sound hook is fine structurally, but two practical problems can stop it:
  - Browser autoplay rules: audio triggered by realtime events can be blocked until the user taps/clicks once.
  - Persisted mute state: localStorage can contain vendor-notification-sound=false or rider-notification-sound=false, which makes the hook skip.

3) Google Maps “blocked”
- RiderOrders and RiderFloatingWidget open maps via window.open("https://www.google.com/maps/search/?api=1&query=...")
- In some devices/browsers/PWA contexts, Google domains are blocked or window.open is blocked.
- We should provide:
  - A provider fallback (OpenStreetMap link always available)
  - A copy-link option
  - Prefer <a target="_blank"> over window.open in many places (less likely blocked)

Planned implementation (what I will change)

A) Make earnings reliable by recording wallet transactions inside the backend (not relying on external webhooks)
1) Add two database triggers (most reliable, covers all flows)
- Trigger #1: When an order payment becomes “paid”
  - Condition: payment_status changes to 'paid' (old != 'paid', new == 'paid')
  - Action:
    - Compute splits:
      - platform commission = subtotal * (commission_rate / 100)
      - vendor share = subtotal - platform commission
      - delivery split (if used): rider share = delivery_fee * 0.8, platform delivery share = delivery_fee * 0.2
    - Update platform wallet and vendor wallet balances appropriately (production vs development/test):
      - If order.environment = 'production': update platform_wallet.balance and wallets.pending_balance etc.
      - If order.environment = 'development': update platform_wallet.test_balance and wallets.test_pending_balance etc.
    - Insert wallet_transactions rows (idempotent; do nothing if already exists for this order/category):
      - platform_commission (credit, platform)
      - vendor_share (credit, vendor; pending status)
- Trigger #2: When a rider gets assigned to a paid order
  - Condition: rider_id changes from NULL -> NOT NULL AND payment_status='paid'
  - Action:
    - Credit rider wallet (again production vs development/test fields)
    - Insert wallet_transactions row for rider_share (idempotent)

Why triggers:
- They run regardless of whether payment was confirmed via verify-payment or a webhook.
- They also cover manual rider claiming (RiderAvailableOrders updates rider_id from the client) and auto-assignment (assign-rider function).

2) Update the payment verification function to be consistent and safe
- Update supabase/functions/paystack-verify-payment to:
  - Use the correct Paystack secret key based on platform environment (same approach as initialize/webhook).
  - Keep setting order.payment_status='paid'
  - Not attempt to do wallet splitting itself (or do it only as a fallback), because the triggers will handle it.
  - Important: ensure idempotency remains safe (triggers also check existing wallet_transactions before inserting).

3) Backfill: fix existing paid orders that already happened
- Triggers won’t automatically “re-run” for old paid orders.
- Add an admin-only backend function (edge function) to backfill missing wallet_transactions:
  - It will scan orders where payment_status='paid' and no ledger rows exist yet.
  - It will “replay” the same logic safely (idempotent checks) to update wallets and insert wallet_transactions.
- Also add a small admin UI button (in Admin Settings or Admin Dashboard) called “Sync Earnings / Backfill Ledger” so you can run it once.

B) Update RiderEarnings + VendorEarnings UI to show the correct numbers per environment (and avoid staff-access problems)
1) Environment-aware balances
- Use useEnvironmentConfig (already exists) to detect effective environment.
- In development/test mode, show test_* columns (test_balance/test_pending_balance/test_eligible_balance) and show a “TEST MODE” label in the earnings cards.
- In production mode, show the normal columns (balance/pending_balance/eligible_balance).

2) Use wallet_transactions as the source of truth for history and totals
- Transaction History: filter by wallet_id and (optional) by environment when in test mode.
- Totals:
  - Total Earned can be computed by summing credits from wallet_transactions (instead of relying on wallet.total_earned, which is currently always 0).
  - This will make the “Earnings tab” match reality once the ledger rows exist.

3) Vendor staff access (important)
- Right now, wallets table RLS only lets a user read their own wallet. Vendor staff (manager) cannot read the owner’s wallet directly.
- Safer fix:
  - Keep bank details private to the owner.
  - Create a backend function (edge function) get-vendor-earnings that:
    - verifies the logged-in user is either the vendor owner OR an active vendor_staff with view_earnings permission
    - returns wallet summary + transactions with sensitive bank fields removed for non-owners
  - VendorEarnings page will use this function instead of direct wallet queries, preventing “blank earnings” for staff logins.

C) Fix notification sound so it reliably repeats every 10 seconds
1) Improve the repeating sound hook
- Enhance useRepeatingNotificationSound to track:
  - lastPlayError / isAudioBlocked (e.g., NotAllowedError)
  - an unlock() method that plays once (must be user-initiated)
- If audio is blocked, show a small banner on the page:
  - “Tap to enable sound” button → calls unlock()

2) Add a visible sound toggle + Test Sound button on:
- Vendor Orders page
- Rider Orders page
- Rider Available Orders page
This will:
- ensure localStorage isn’t stuck on “false”
- provide the required user gesture to unlock audio playback

3) Start/stop rules (exact behavior you asked for)
- Vendor:
  - Start repeating when a new order INSERT arrives for that vendor.
  - Stop repeating when the vendor updates the order (confirm/preparing/ready_for_pickup) or cancels.
- Rider:
  - Available orders page:
    - Start repeating when a new available order appears within radius (count increases).
    - Stop repeating when rider claims an order or goes offline.
  - Assigned orders page:
    - Start repeating when a new order is assigned (rider_id becomes yours) or when there is an order waiting for pickup.
    - Stop repeating as soon as rider takes action (picked_up / on_the_way / delivered verification).

D) Maps: fix “google.com blocked” and add a better in-app map option
1) Replace direct window.open calls
- Replace window.open(...) usage in RiderOrders and RiderFloatingWidget with a small “Map options” menu component that offers:
  - Open in OpenStreetMap (always available)
  - Open in Google Maps (if not blocked)
  - Copy link
- Prefer <a href target="_blank" rel="noopener noreferrer"> for opening external maps (less likely blocked than window.open in many environments).

2) In-app map preview (no Google dependency)
- Add a modal “View Map” that embeds OpenStreetMap for:
  - Pickup (vendor lat/lng already available)
  - Delivery (geocode delivery_address_text on-demand using the existing geocode-address function; then display marker)
- This gives you a working map experience even if Google is blocked.

Testing checklist (how we’ll confirm it’s fixed)
1) Earnings
- Place a test payment → after verification:
  - wallet_transactions should have platform_commission and vendor_share rows for that order
  - vendor pending (or test_pending) should increase
- Assign/claim a rider for that paid order:
  - wallet_transactions should get a rider_share row
  - rider balance (or test_balance) should increase
- Run “Backfill Ledger” once:
  - old paid orders should begin showing transactions and balances.

2) Notification sound
- Turn sound on and tap “Test Sound” (confirms audio unlocked).
- Create a new order:
  - vendor hears sound every 10s until they update the order
- Make an order available / assigned:
  - rider hears sound every 10s until claim/update.

3) Maps
- Clicking Map shows the options menu.
- OpenStreetMap link always works.
- Copy link works even if Google is blocked.

Files/areas that will be changed (high level)
- Backend
  - supabase/functions/paystack-verify-payment/index.ts
  - (optional) supabase/functions/paystack-webhook/index.ts to stay consistent / idempotent
  - New: supabase database migration adding triggers + helper SQL functions
  - New: admin-only backfill backend function
  - New: get-vendor-earnings backend function (for staff-safe access)
- Frontend
  - src/pages/rider/RiderEarnings.tsx
  - src/pages/vendor/VendorEarnings.tsx
  - src/pages/vendor/VendorOrders.tsx
  - src/pages/rider/RiderOrders.tsx
  - src/pages/rider/RiderAvailableOrders.tsx
  - src/components/rider/RiderFloatingWidget.tsx
  - src/hooks/useRepeatingNotificationSound.ts
  - New small UI component(s): MapOptionsMenu, MapPreviewModal, SoundEnableBanner

Notes / constraints
- This project is currently in TEST MODE (platform_environment=development). So we will show and update the test_* balances clearly, and keep production balances separate.
- We will not expose vendor owner bank details to staff accounts; staff can see earnings summary and transaction history only if permitted.

After you approve this plan
- I’ll implement the backend ledger triggers + backfill tooling first (so earnings immediately become real), then update the earnings pages, then finish with notification sound + map fixes.
