

## Analysis

The console logs confirm the API key IS being returned successfully: `data: { key: "AIzaSyCfVNiZQNP9_87_XBVRh62hCkEQjWMu4MI" }`. The key extraction logic works. The problem is likely that `loadGoogleMaps()` is failing (the Google Maps JavaScript API script fails to load, possibly due to API key domain restrictions) but the error handling conflates both failure modes.

However, the displayed error says "Google Maps key not available" rather than "Failed to load map", which suggests either:
1. A stale cached build is running older code
2. The component re-mounts and the `cancelled` flag triggers before the map initializes

## Plan

1. **Replace `supabase.functions.invoke` with direct `fetch`** in `MapLocationPicker.tsx` -- this is more reliable and avoids any response parsing quirks from the Supabase client SDK.

2. **Add granular error messages** to distinguish between:
   - "Failed to fetch API key" (network/auth error)
   - "API key not configured" (server returned no key)
   - "Failed to load Google Maps script" (script load error, likely domain restriction)

3. **Add `console.error` at each failure point** so the next time we can immediately see what fails.

4. **Fix the `cancelled` race condition** -- avoid setting error when `cancelled` is true (the current code sets error even when cancelled).

### File: `src/components/shared/MapLocationPicker.tsx`

Replace the `useEffect` async block to use direct `fetch` with proper auth headers, and add distinct error messages at each failure point. Keep the rest of the component unchanged.

