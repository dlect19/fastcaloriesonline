- Vendor wallet buckets are derived only by reconcile_vendor_wallet (service-role) from the completed ledger; it never writes balance and freezes payouts on drift — balance changes only via post_wallet_entry or the audited correction.

- Weather for pricing, dispatch, cart and admin refresh goes only through _shared/weather-service.ts (cached, logged); only weather-provider.ts may call a weather API — keeps quote, checkout and rider surge consistent.
- Live rider location is written only via the publish_rider_location RPC (server-derived rider/order link, validated, rate-limited) into latest-only rider_live_locations; customers read via RLS/realtime and map calls never run per GPS point.
