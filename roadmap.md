# Admin ad statistics
- [x] Fixed event identity, atomic counters, viewport/document visibility with occlusion check, retry-safe deduplication and 15-second/focus admin refresh; 12 focused tests and all 748 tests passed, preview build OK. Restored only the reported ad's one saved view; zero saved clicks. Backend migration applied; frontend publication remains owner's next step. No live test events generated.

# Customer live-map visuals
- [x] Branded rider/delivery markers, direct distance line, accessible distance badge and stable framing; 62 focused tests passed, preview build/type checks clean. Live Google Maps rendering requires owner verification on an authorized origin.

# Spin & Win App Review compliance
- [x] Restrict native iOS to free spins at screen, component and invocation levels.
- [x] Add permanently accessible official rules and supplied Apple disclaimer.
- [x] Verify iOS/Android/web rendering with mocked Capacitor platforms, free/bonus logic and payment regressions without live transactions; 610 tests passed, preview build clean, mobile rules visually checked. Physical compiled iOS verification requires a rebuilt app.
# Rider live tracking recovery (FC-261006-6839)
- [x] Immediate first publish, realtime order trigger, permission/status/retry, bounded customer waiting, map at top of Order Detail, tests.
- [ ] Owner: rebuild/reinstall native Android/iOS apps (bundled assets) — needs owner's build machine.
