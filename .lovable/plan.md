
# Implementation Plan: Fixing Reported Issues and Adding Vendor-Rider Management

## Overview

This plan addresses six reported issues and introduces a new vendor-rider management system. The implementation will be done in phases to ensure stability.

---

## Issues Summary

| Issue | Root Cause | Solution |
|-------|------------|----------|
| 1. Health Goals Failure | Database CHECK constraint only allows `maintain`, `light_eating`, `active_lifestyle` but app sends `lose_weight`, `gain_weight`, `build_muscle` | Alter constraint to allow all 6 values |
| 2. Search Button Not Working | No actual search navigation - header only triggers `onSearch` callback which isn't connected to search page | Add search submission to navigate to `/explore` with query param |
| 3. QR Code Scanner Not Working | Dialog shows placeholder camera icon instead of actual scanner | Integrate native camera QR scanning with fallback |
| 4. Navigation App Not Respecting Admin Setting | `MapOptionsMenu` shows all navigation apps statically, ignores `default_navigation_app` setting | Fetch setting and show only the configured app |
| 5. Download Button Link | "Download App" button navigates to `/auth` instead of `/install` | Change navigation target to `/install` |
| 6. Vendor-Rider System Enhancement | Riders joining via vendor invite can still see all platform orders | Restrict vendor-affiliated riders to vendor-only orders |

---

## Phase 1: Database Changes

### 1.1 Fix Health Goal Constraint

The `profiles` table has a CHECK constraint that only allows three values:
```sql
CHECK ((health_goal = ANY (ARRAY['maintain', 'light_eating', 'active_lifestyle'])))
```

The app offers four different values:
- `lose_weight`, `maintain`, `gain_weight`, `build_muscle`

**Solution**: Drop the old constraint and create a new one that supports all 6 values (both old and new):

```sql
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_health_goal_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_health_goal_check 
  CHECK (health_goal IS NULL OR health_goal = ANY (ARRAY[
    'maintain', 'light_eating', 'active_lifestyle',
    'lose_weight', 'gain_weight', 'build_muscle'
  ]));
```

---

## Phase 2: Frontend Fixes

### 2.1 Search Button Navigation

**File**: `src/components/home/Header.tsx`

**Current behavior**: The search input calls `onSearch?.(e.target.value)` on change, but nothing happens on Enter/submit.

**Fix**: Add form submission that navigates to `/explore?q={searchQuery}` when user presses Enter:

```tsx
const handleSearchSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (searchQuery.trim()) {
    navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
  }
};
```

**Also update** `src/pages/Explore.tsx` to read `?q=` from URL and pre-populate the search field.

---

### 2.2 QR Code Scanner Integration

**File**: `src/components/home/Header.tsx`

**Current behavior**: Shows a placeholder camera icon with instructions to "use your camera app."

**Fix**: Implement actual camera-based QR scanning using the browser's `BarcodeDetector` API (with fallback for unsupported browsers):

1. Request camera access via `navigator.mediaDevices.getUserMedia`
2. Stream video to a hidden `<video>` element
3. Use `BarcodeDetector` API to detect QR codes
4. Parse the QR content (expected format: `https://.../vendor/{id}?action=favorite`)
5. Navigate to vendor page with favorite action

For browsers without `BarcodeDetector` support, show instructions to use the native camera app.

---

### 2.3 Navigation App Respect Admin Setting

**File**: `src/components/shared/MapOptionsMenu.tsx`

**Current behavior**: Shows all 5 navigation apps (Google, Bing, OSM, HERE, native).

**Fix**:
1. Create a new hook `usePlatformSettings()` to fetch `default_navigation_app` setting
2. Update `MapOptionsMenu` to:
   - Show only the admin-configured app as the primary option
   - Optionally show "Other apps" in a submenu for flexibility

---

### 2.4 Download Button Link

**File**: `src/pages/Home.tsx` (line 181-187)

**Current code**:
```tsx
<Button
  onClick={() => navigate('/auth')}
  variant="secondary"
  className="font-semibold shadow-lg"
>
  Download App
</Button>
```

**Fix**: Change navigation target:
```tsx
onClick={() => navigate('/install')}
```

---

## Phase 3: Vendor-Rider Restriction System

### 3.1 Architecture Overview

When a rider joins a vendor's team via invite, they become a "vendor-affiliated rider" who can ONLY see and accept orders from that specific vendor.

```text
+-------------------+       +-------------------+       +-------------------+
|     Vendor        |       |   vendor_riders   |       |  Rider Profile    |
|  (My Riders tab)  |------>|  (link table)     |<------|  (affiliated      |
|                   |       |                   |       |   vendor_id)      |
+-------------------+       +-------------------+       +-------------------+
         |                          |
         v                          v
  Generate Invite              Join Flow
  (QR code/link)         (creates link + sets affiliation)
```

### 3.2 Database Changes

Add a column to track restriction mode (for future flexibility):

```sql
ALTER TABLE public.vendor_riders 
  ADD COLUMN IF NOT EXISTS restriction_mode TEXT 
  DEFAULT 'vendor_only' 
  CHECK (restriction_mode IN ('vendor_only', 'any_orders'));
```

### 3.3 Backend Changes: Available Orders Filter

**File**: `src/pages/rider/RiderAvailableOrders.tsx`

Update the order fetching logic to:
1. Check if rider has `affiliated_vendor_id` set
2. If affiliated, filter orders to only show those from the affiliated vendor
3. If not affiliated (platform rider), show all nearby orders

```tsx
// Current query
.select('*, vendors(name, address, latitude, longitude)')
.eq('status', 'ready_for_pickup')
.is('rider_id', null)
.neq('delivery_type', 'self_pickup')

// Updated query for affiliated riders
if (profile.affiliated_vendor_id) {
  query = query.eq('vendor_id', profile.affiliated_vendor_id);
}
```

### 3.4 UI Changes: Hide Sensitive Information

For vendor-affiliated riders, hide revenue/fee information they shouldn't see:

**Files to update**:
- `src/pages/rider/RiderDashboard.tsx` - Hide "Today's Earnings" if affiliated
- `src/pages/rider/RiderAvailableOrders.tsx` - Hide "You'll earn" amount
- `src/pages/rider/RiderOrders.tsx` - Hide earning amounts
- `src/pages/rider/RiderEarnings.tsx` - Block access or show simplified view

Create a helper hook `useRiderRestrictions()`:
```tsx
export function useRiderRestrictions(riderProfile: RiderProfile | null) {
  const isAffiliated = !!riderProfile?.affiliated_vendor_id;
  
  return {
    isAffiliated,
    canViewEarnings: !isAffiliated, // Platform riders can see earnings
    canViewAllOrders: !isAffiliated, // Platform riders see all orders
  };
}
```

### 3.5 Vendor Control Panel Enhancements

**File**: `src/pages/vendor/VendorRiders.tsx`

Add controls for vendor to manage their riders:
1. Activate/Deactivate riders (already exists)
2. View rider's delivery stats for their vendor only
3. Remove rider from team

---

## Phase 4: Vendor-Rider Login Flow (Optional Enhancement)

Currently, riders who join a vendor's team use the standard `/rider/auth` page. For a dedicated experience:

### Option A: Use Existing Flow (Recommended)
- Riders continue using `/rider/auth`
- After login, the system detects their `affiliated_vendor_id` and adjusts their dashboard accordingly
- The vendor's branding is shown in the rider dashboard header

### Option B: Dedicated Login Page
Create `/rider/login/:vendorId` similar to `/vendor/staff-login/:vendorId`:
- Shows vendor branding
- Validates rider is affiliated with that vendor
- Redirects to restricted rider dashboard

---

## Implementation Checklist

### Database Migration
- [ ] Drop old `profiles_health_goal_check` constraint
- [ ] Add new constraint with all 6 health goal values

### Frontend Updates
- [ ] `Header.tsx` - Add search form submission with Enter key
- [ ] `Header.tsx` - Implement BarcodeDetector QR scanning
- [ ] `Explore.tsx` - Read `?q=` query param on load
- [ ] `MapOptionsMenu.tsx` - Use admin-configured navigation app
- [ ] `Home.tsx` - Change Download button to `/install`

### Rider Restriction System
- [ ] `RiderAvailableOrders.tsx` - Filter orders by affiliated vendor
- [ ] `RiderDashboard.tsx` - Conditionally hide earnings for affiliated riders
- [ ] `RiderOrders.tsx` - Hide earnings info for affiliated riders
- [ ] `useRiderRestrictions.ts` - Create helper hook

### Hooks and Utilities
- [ ] `usePlatformSettings.ts` - New hook for fetching platform settings

---

## Technical Notes

### QR Scanner Browser Support
- `BarcodeDetector` is supported in Chrome 88+, Edge 88+, Opera 74+
- Safari and Firefox do not support it
- For unsupported browsers, show fallback with manual entry option

### Health Goals Mapping
The app will use the new values (`lose_weight`, `maintain`, `gain_weight`, `build_muscle`). Old values in the database (`light_eating`, `active_lifestyle`) will still be valid but may not render correctly in the UI until the user updates their goal.

---

## Testing Recommendations

After implementation:
1. Test health goals save/update with all 6 values
2. Test search navigation from home page
3. Test QR scanning on supported browsers
4. Verify only the admin-configured navigation app appears
5. Test rider invitation flow end-to-end
6. Verify affiliated riders only see their vendor's orders
7. Confirm earnings are hidden for affiliated riders
