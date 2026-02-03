

# Dynamic Delivery Fee Fix

## Problem Summary
The delivery fee is always showing ₦500 because the distance-based calculation requires coordinates (latitude/longitude) for both the vendor and customer address, but **no coordinates are being saved** when:
1. Customers add delivery addresses
2. Vendors save their business location

The geocoding utilities exist (`src/lib/geocoding.ts`) but are never called when saving addresses.

## Current Data State
- **Customer Addresses**: All addresses have `latitude: null, longitude: null`
- **Vendors**: 4 out of 5 vendors have no coordinates stored
- **Platform Settings**: Correctly configured with base fee ₦500, 3km base distance, ₦100/km extra

## Technical Solution

### 1. Auto-Geocode Customer Addresses
Update the address creation flow in **two components** to automatically geocode addresses after saving:

**Files to modify:**
- `src/components/cart/AddressSelector.tsx`
- `src/components/profile/AddressesCard.tsx`

**Changes:**
- Import `geocodeAndUpdateAddress` from `@/lib/geocoding`
- After successfully inserting an address, call the geocoding function
- Show a loading indicator while geocoding
- Display the calculated distance in the cart for transparency

### 2. Auto-Geocode Vendor Locations
Update vendor settings to automatically geocode when the address is saved:

**File to modify:**
- `src/pages/vendor/VendorSettings.tsx`

**Changes:**
- Import `geocodeAndUpdateVendor` from `@/lib/geocoding`
- After successfully updating vendor info, geocode the address
- Store the resulting coordinates in the vendors table

### 3. Add Distance Display in Cart
Show the calculated distance and delivery fee breakdown in the Order Summary:

**File to modify:**
- `src/components/cart/OrderSummary.tsx`

**Changes:**
- Accept optional `distanceKm` prop
- Display distance when available (e.g., "2.5 km away")
- Add visual indicator when coordinates are missing

### 4. Backfill Existing Data (Optional Manual Step)
For existing addresses and vendors without coordinates, provide a way to re-geocode:
- Vendors can trigger geocoding by re-saving their settings
- Customers can re-add addresses or the system can show a prompt to update

## Implementation Details

### AddressSelector.tsx Changes
```typescript
import { geocodeAndUpdateAddress } from '@/lib/geocoding';

// After successful insert:
if (data) {
  // Geocode in background
  geocodeAndUpdateAddress(data.id, formData.address_line, formData.city, formData.state)
    .then((result) => {
      if (result) {
        // Update the local state with coordinates
        onSelect({ ...data, latitude: result.latitude, longitude: result.longitude });
      }
    });
}
```

### VendorSettings.tsx Changes
```typescript
import { geocodeAndUpdateVendor } from '@/lib/geocoding';

// In handleSave, after successful update:
if (!error) {
  geocodeAndUpdateVendor(vendor.id, formData.address, formData.city, formData.state);
}
```

### OrderSummary.tsx Enhancement
```typescript
// Add distance display
{distanceKm !== null && distanceKm !== undefined && (
  <div className="flex justify-between text-muted-foreground text-sm">
    <span>Distance</span>
    <span>{distanceKm.toFixed(1)} km</span>
  </div>
)}
```

## Expected Outcome
- New addresses will automatically get coordinates via OpenStreetMap geocoding
- Vendor locations will be geocoded when settings are saved
- Delivery fees will be calculated as: **₦500 base + ₦100 per km beyond 3km**
- Example: 5km distance = ₦500 + (5-3) × ₦100 = ₦700
- Example: 2km distance = ₦500 (base fee applies)

## Files to Modify
1. `src/components/cart/AddressSelector.tsx` - Geocode new addresses
2. `src/components/profile/AddressesCard.tsx` - Geocode new addresses
3. `src/pages/vendor/VendorSettings.tsx` - Geocode vendor location on save
4. `src/components/cart/OrderSummary.tsx` - Display distance info
5. `src/pages/Cart.tsx` - Pass distance to OrderSummary

