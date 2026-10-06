- Vendor wallet buckets are derived only by reconcile_vendor_wallet (service-role) from the completed ledger; it never writes balance and freezes payouts on drift — balance changes only via post_wallet_entry or the audited correction.

- Weather for pricing, dispatch, cart and admin refresh goes only through _shared/weather-service.ts (cached, logged); only weather-provider.ts may call a weather API — keeps quote, checkout and rider surge consistent.
