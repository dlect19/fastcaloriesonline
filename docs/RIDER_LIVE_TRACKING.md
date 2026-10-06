# Rider live tracking

- **Publish:** the rider app (`useRiderLiveTracking`, mounted in RiderLayout) watches GPS only while the signed-in rider has an active delivery (`assigned`, `picked_up`, `on_the_way`). It sends updates through the `publish_rider_location` RPC, which works out the rider/order link from `auth.uid()`, checks the update and rate-limits it, then upserts one latest row in `rider_live_locations`.
- **Read:** the customer's order page (`LiveRiderMap`) reads that row through RLS (own active order only) and listens for changes to that order's row in real time. The map loads once and only the marker moves. No routing calls are made.
- **Stop:** an orders trigger deletes the row on delivered or cancelled, rider change or delivery-type change. The client stops when the server returns `stop: true`, when the kill switch is off, or on unmount/logout. A daily cleanup job (`cleanup-rider-live-locations`, 02:30 UTC) enforces retention (default 24 h, max 72 h).
- **Settings** (`platform_settings`, admin card in Riders → Distance): `rider_tracking_enabled`, `_moving_interval_s` (10–15), `_stationary_interval_s` (30–60), `_stale_after_s`, `_retention_hours`, `_min_server_interval_s`, `_daily_cap`, `_route_refresh_min` (reserved).

## Native settings
- **Android:** `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are already used through the rider Prominent Disclosure flow. Tracking runs while the app is open, in the foreground. Background updates depend on the existing rider foreground service; there is no extra background-location plugin.
- **iOS:** `NSLocationWhenInUseUsageDescription` must be in Info.plist. Tracking runs while the app is open. Background tracking would need `UIBackgroundModes: location`, the "Always" permission and App Store review, and has **not** been added.
