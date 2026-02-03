
# Upgrade Geocoding: Add Photon API for Better Nigerian Address Coverage

## Current Problem
The current Nominatim-based geocoding fails for most informal Nigerian addresses:
- "Ikosi Ketu" → Not found
- "Ishefun busstop Megida Ayobo" → Not found

This forces customers to manually capture GPS, which can lead to errors (like capturing coordinates while at vendor location instead of home).

## Solution: Add Photon as Primary Geocoding Provider

**Photon** (https://photon.komoot.io) is a free, open-source geocoder built on OpenStreetMap data with:
- **Fuzzy matching** - handles typos and informal names
- **Better Nigerian coverage** - found "Ikosi Ketu" and "Isefun Road Ayobo" that Nominatim missed
- **No API key required** - fair use policy, no signup needed

### Test Results Showing Photon's Superiority

| Address | Nominatim | Photon |
|---------|-----------|--------|
| "Ikosi Ketu Lagos" | Not found | `6.600556, 3.383611` (Kosofe) |
| "Ketu Lagos" | Not found | `6.5825691, 3.4076019` (Agboyi Ketu) |
| "Ishefun Ayobo Lagos" | Not found | `6.578731, 3.207013` (Alimosho) |

---

## Implementation Plan

### 1. Update Geocode Edge Function
**File:** `supabase/functions/geocode-address/index.ts`

Add Photon as the **primary geocoder**, with Nominatim as fallback:

**Geocoding Flow:**
```
User Address
     |
     v
+--------------------+
|   Try Photon API   |
| (fuzzy matching,   |
|  better coverage)  |
+---------+----------+
          |
          v (no results)
+--------------------+
| Fallback: Nominatim|
| (current 5-strategy|
|  approach)         |
+---------+----------+
          |
          v
   Return coordinates
   or "not found"
```

**Photon API Format:**
```typescript
// Photon query
const photonUrl = `https://photon.komoot.io/api?q=${encodeURIComponent(query)}&limit=3`;

// Response format
{
  "features": [{
    "properties": { "name": "Ikosi", "city": "...", "state": "Lagos State", "county": "Kosofe" },
    "geometry": { "coordinates": [longitude, latitude] }
  }]
}
```

### 2. Filter Results by Location Bias
To avoid getting results from the wrong "Ketu" (there are multiple in Nigeria), add Lagos location bias:

```typescript
// Bias toward Lagos coordinates (6.5, 3.4)
const photonUrl = `https://photon.komoot.io/api?q=${query}&lat=6.5&lon=3.4&limit=3`;
```

### 3. Pick Best Result from Multiple Candidates
Photon returns multiple results ranked by relevance. Select the one closest to Lagos center or with matching state/county.

---

## Technical Details

### Edge Function Changes

```typescript
// New function to try Photon geocoding
async function tryPhotonGeocode(query: string): Promise<GeocodeResult | null> {
  const encodedQuery = encodeURIComponent(query);
  // Bias toward Lagos center for Nigerian addresses
  const url = `https://photon.komoot.io/api?q=${encodedQuery}&lat=6.5&lon=3.4&limit=5`;
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'FastCalories/1.0' }
  });
  
  if (!response.ok) return null;
  
  const data = await response.json();
  if (!data.features || data.features.length === 0) return null;
  
  // Find best match - prefer results in Lagos State
  const lagosResult = data.features.find(f => 
    f.properties.state?.toLowerCase().includes('lagos')
  );
  const result = lagosResult || data.features[0];
  
  return {
    latitude: result.geometry.coordinates[1], // Note: [lon, lat] order
    longitude: result.geometry.coordinates[0],
    display_name: [
      result.properties.name,
      result.properties.city || result.properties.county,
      result.properties.state
    ].filter(Boolean).join(', '),
    confidence: 0.8,
    city: result.properties.city || result.properties.county || '',
    state: result.properties.state || '',
  };
}
```

### Updated Main Flow

```typescript
// In Deno.serve handler:

// Step 1: Try Photon first (better for informal Nigerian addresses)
const photonResult = await tryPhotonGeocode(fullQuery);
if (photonResult) {
  console.log(`Photon found: ${photonResult.display_name}`);
  return Response.json(photonResult, { headers: corsHeaders });
}

// Step 2: Fall back to Nominatim with multiple strategies
// ... existing 5-strategy Nominatim code ...
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/geocode-address/index.ts` | Add Photon as primary geocoder, keep Nominatim as fallback |

---

## Expected Improvements

After this change:
- "Ikosi Ketu" → Will find `6.600556, 3.383611` via Photon
- "Ishefun Ayobo" → Will find `6.578731, 3.207013` via Photon  
- Customers will more often get automatic coordinates without needing GPS capture
- Fewer "Address not found" errors
- More accurate delivery fee calculations from the start

---

## Fallback Strategy

```
1. Photon with Lagos bias (NEW - primary)
2. Photon without bias (NEW - secondary)  
3. Nominatim full query (existing)
4. Nominatim without city (existing)
5. Nominatim area name only (existing)
6. GPS capture required (last resort)
```

This layered approach maximizes the chance of finding coordinates automatically while maintaining full backward compatibility.
