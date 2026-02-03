
# Fix: Address Coordinate Mismatch and GPS-First Enforcement

## Problem Analysis

### Root Cause
The user's "Home" address (Ketu, 20.6km from vendor) has the **exact same GPS coordinates** as the vendor in Ayobo:
- **Vendor (Dlect food)**: `6.575631, 3.203979` (Ayobo)  
- **Customer "Home" address**: `6.575631, 3.203979` (stored for Ketu)

This happens because:
1. The "Refresh GPS" button captures the **device's current location** at the moment it's clicked
2. If the customer was physically at the vendor's location (e.g., testing the app) when they clicked "Refresh GPS", it saved the vendor's coordinates instead of their actual home location
3. The system then calculates distance as 0km because both points are identical

### Why Text-Based Geocoding Fails
OpenStreetMap/Nominatim has limited coverage of informal Nigerian addresses:
- "ikosi ketu" → Not found
- "2/4jamiu balogun ikosi ketu" → Not found  
- "Ishefun busstop Megida Ayobo" → Not found

This forces reliance on GPS capture, but GPS captures **current location**, not the address location.

---

## Solution: GPS-First with Validation

### Strategy
1. **Require GPS capture at the delivery location** - Users must be at their delivery address when capturing GPS
2. **Improve geocoding fallbacks** - Try multiple search strategies before giving up
3. **Add mismatch detection** - Warn if captured GPS is suspiciously close to vendor

---

## Implementation Plan

### 1. Improve Geocoding Edge Function
**File:** `supabase/functions/geocode-address/index.ts`

Add fallback search strategies:
- Try original query first
- If no results, retry without city (just address + state + country)
- If still no results, retry with just the neighborhood/area name
- Add Lagos bounding box to improve accuracy for Nigerian addresses

```text
+-------------------+
|  Original Query   |
| "address, city,   |
|  state, country"  |
+---------+---------+
          |
          v (no results)
+-------------------+
| Fallback 1: Skip  |
| city parameter    |
| "address, state,  |
|  country"         |
+---------+---------+
          |
          v (no results)
+-------------------+
| Fallback 2: Area  |
| name only with    |
| bounding box      |
+---------+---------+
          |
          v
     Return result
     or null
```

### 2. Add GPS Capture Warning
**File:** `src/components/cart/AddressSelector.tsx`

When user clicks "Refresh GPS", show a confirmation dialog explaining they must be at their delivery location:

- Display: "Are you at [Address Label] right now?"
- Subtext: "GPS will capture your current location. Please only continue if you are physically at this delivery address."
- Buttons: "Yes, I'm Here" / "Cancel"

This prevents accidental captures when user is at wrong location.

### 3. Add Coordinate Sanity Check
**File:** `src/pages/Cart.tsx`

Detect when customer coordinates are suspiciously close to vendor:
- If distance < 0.5km AND address city differs from vendor city → flag as potential mismatch
- Show warning: "Your saved GPS location appears to be near the restaurant, not your delivery address. Please update your GPS location."

### 4. Block Order Until Coordinates Verified
**File:** `src/pages/Cart.tsx`

The current implementation already blocks checkout if coordinates are missing. Enhance it to also block when mismatch is detected.

### 5. Clear Stale Coordinates for Affected User
**Database:** One-time fix

Clear the incorrect coordinates from the "Home" address so user can re-capture correctly.

---

## Technical Details

### Edge Function Changes
```typescript
// Fallback search strategies for Nigerian addresses
const searchStrategies = [
  `${address}, ${city}, ${state}, ${country}`,           // Original
  `${address}, ${state}, ${country}`,                     // Skip city
  `${address.split(' ').slice(-2).join(' ')}, ${state}`, // Last 2 words (area name)
];

// Add Lagos bounding box for more accurate results
const lagosViewbox = '3.0,6.3,3.6,6.7'; // lon1,lat1,lon2,lat2
```

### GPS Confirmation Dialog
```typescript
// Before capturing GPS for existing address
const handleUpdateAddressGps = (addressId: string) => {
  const address = addresses.find(a => a.id === addressId);
  // Show confirmation dialog
  setGpsConfirmDialog({
    open: true,
    addressId,
    addressLabel: address?.label || 'this address',
  });
};

// Only capture after user confirms
const confirmGpsCapture = () => {
  setUpdatingGps(gpsConfirmDialog.addressId);
  setPendingGpsUpdate(gpsConfirmDialog.addressId);
  getCurrentPosition();
  setGpsConfirmDialog({ open: false, addressId: null, addressLabel: '' });
};
```

### Coordinate Mismatch Detection
```typescript
// In Cart.tsx
const coordinateMismatch = useMemo(() => {
  if (!hasCoordinates || distanceKm === null || distanceKm > 0.5) return false;
  
  // Distance is very small - check if cities differ
  const vendorCity = vendorLocation.address?.toLowerCase() || '';
  const customerCity = selectedAddress?.city?.toLowerCase() || '';
  
  // If vendor is in "Ayobo" and customer says "Ketu", but distance is 0km - mismatch!
  return !vendorCity.includes(customerCity) && !customerCity.includes(vendorCity);
}, [hasCoordinates, distanceKm, vendorLocation, selectedAddress]);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/geocode-address/index.ts` | Add fallback search strategies, Lagos bounding box |
| `src/components/cart/AddressSelector.tsx` | Add GPS capture confirmation dialog |
| `src/pages/Cart.tsx` | Add coordinate mismatch detection and warning |
| Database | Clear stale coordinates from affected address |

---

## User Flow After Implementation

1. Customer adds address with text (e.g., "Ikosi Ketu")
2. System tries geocoding with multiple fallback strategies
3. If geocoding fails → GPS capture required before checkout
4. When customer clicks GPS button → confirmation dialog appears
5. Customer confirms they are at delivery address → GPS captured
6. If captured coordinates are near vendor but address is far → mismatch warning shown
7. Order blocked until proper coordinates are set

This ensures FastCalories never loses money due to undercharged delivery fees from incorrect coordinates.
