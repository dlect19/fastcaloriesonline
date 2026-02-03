
# Enhanced Geocoding: Run Photon and Nominatim in Parallel

## Current Approach
Right now the geocoder tries Photon first, and only if Photon fails does it try Nominatim. This sequential approach means we miss cases where Nominatim might find a result that Photon missed.

## New Approach: Parallel Geocoding with Best Result Selection

Run **both Photon and Nominatim at the same time**, then pick the best result from either provider.

```
User Address
     |
     v
+------------------+     +------------------+
|  Photon API      |     |  Nominatim API   |
|  (fuzzy match,   |     |  (structured,    |
|   Lagos bias)    |     |   5 strategies)  |
+--------+---------+     +--------+---------+
         |                        |
         +-------+    +-----------+
                 |    |
                 v    v
          +------------------+
          | Merge & Score    |
          | - Compare coords |
          | - Pick highest   |
          |   confidence     |
          +--------+---------+
                   |
                   v
            Return best result
            + all suggestions
```

---

## Implementation Details

### 1. Parallel API Calls
Use `Promise.all()` to run both geocoders simultaneously:

```typescript
const [photonResults, nominatimResult] = await Promise.all([
  tryPhotonGeocode(query, address, true),
  geocodeWithNominatim(address, city, state, country)
]);
```

### 2. Result Scoring & Selection
Compare results from both providers and pick the best one:

```typescript
function selectBestResult(
  photonResult: GeocodeResult | null,
  nominatimResult: GeocodeResult | null,
  originalAddress: string
): GeocodeResult | null {
  if (!photonResult && !nominatimResult) return null;
  if (!photonResult) return nominatimResult;
  if (!nominatimResult) return photonResult;
  
  // Both have results - compare confidence and pick best
  // Also check if coordinates are close (within 1km) - if so, prefer higher confidence
  const distance = haversineDistance(
    photonResult.latitude, photonResult.longitude,
    nominatimResult.latitude, nominatimResult.longitude
  );
  
  if (distance < 1) {
    // Same area - pick higher confidence
    return photonResult.confidence >= nominatimResult.confidence 
      ? photonResult 
      : nominatimResult;
  }
  
  // Different areas - pick the one with better address word matches
  const photonScore = scoreAddressMatch(photonResult.display_name, originalAddress);
  const nominatimScore = scoreAddressMatch(nominatimResult.display_name, originalAddress);
  
  return photonScore >= nominatimScore ? photonResult : nominatimResult;
}
```

### 3. Merge Suggestions
Combine suggestions from both providers, deduplicate, and sort by relevance:

```typescript
function mergeSuggestions(
  photonSuggestions: GeocodeSuggestion[],
  nominatimSuggestions: GeocodeSuggestion[]
): GeocodeSuggestion[] {
  const all = [...photonSuggestions, ...nominatimSuggestions];
  
  // Deduplicate by coordinates (within 100m)
  const unique = deduplicateByProximity(all, 0.1);
  
  // Sort by Lagos preference and return top 5
  return unique
    .sort((a, b) => {
      const aLagos = a.state?.toLowerCase().includes('lagos') ? 1 : 0;
      const bLagos = b.state?.toLowerCase().includes('lagos') ? 1 : 0;
      return bLagos - aLagos;
    })
    .slice(0, 5);
}
```

---

## Benefits

| Before (Sequential) | After (Parallel) |
|---------------------|------------------|
| Photon fails → try Nominatim | Both run at same time |
| ~2-4 seconds total | ~1-2 seconds total |
| Miss cases where Nominatim is better | Always get best of both |
| Single provider suggestions | Combined suggestions |

---

## File to Modify

| File | Changes |
|------|---------|
| `supabase/functions/geocode-address/index.ts` | Run Photon + Nominatim in parallel, add result selection logic, merge suggestions |

---

## Technical Details

### Updated Main Flow

```typescript
// Run both providers in parallel
const [photonResults, nominatimResult] = await Promise.all([
  // Photon with multiple query variations
  Promise.all(uniqueQueries.map(q => tryPhotonGeocode(q, address, true))),
  // Nominatim with 5 strategies
  geocodeWithNominatim(address, city || '', state || '', country)
]);

// Flatten Photon results and find best
const photonBest = photonResults
  .filter(r => r.result)
  .sort((a, b) => (b.result?.confidence || 0) - (a.result?.confidence || 0))[0]?.result;

// Collect all suggestions from both
const allSuggestions = [
  ...photonResults.flatMap(r => r.suggestions),
  // Convert Nominatim result to suggestion if not exact match
];

// Pick best overall result
const bestResult = selectBestResult(photonBest, nominatimResult, address);

if (bestResult) {
  return Response.json({ ...bestResult, suggestions: mergeSuggestions(allSuggestions) });
}

// No exact match - return merged suggestions
return Response.json({ 
  error: 'Address not found', 
  suggestions: mergeSuggestions(allSuggestions) 
});
```

### Haversine Distance Helper

```typescript
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

---

## Expected Improvements

1. **Faster responses** - Both APIs run simultaneously instead of waiting for one to fail
2. **Better accuracy** - Pick the best result from whichever provider found it
3. **More suggestions** - Combine suggestions from both providers
4. **Higher success rate** - Cases where only Nominatim works will now be caught immediately
