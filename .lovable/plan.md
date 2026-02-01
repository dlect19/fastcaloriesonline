

# Fix: Sync Rider Affiliation to vendor_riders Table

## Problem Identified
The rider `diptvnetwork@gmail.com` is affiliated with Dlect food via the legacy `rider_profiles.affiliated_vendor_id` column, but the `vendor_riders` table (which the revenue trigger uses) has no corresponding entry.

## Solution Overview
We need to ensure affiliated riders appear in the `vendor_riders` table so:
1. They show up on the vendor's "My Riders" page
2. The revenue trigger correctly routes their earnings to the vendor

---

## Implementation Steps

### Step 1: Database - Add Missing vendor_riders Entry
Create a record in `vendor_riders` to link this rider to Dlect food.

```sql
INSERT INTO vendor_riders (
  vendor_id,
  rider_profile_id,
  invite_code,
  is_active
) VALUES (
  'dab934e5-6938-4969-8de1-27683a745755',  -- Dlect food
  '00f0de4b-b417-4f0a-9d97-ec9f24606722',  -- diptvnetwork rider profile
  'LEGACY',                                  -- Mark as legacy affiliation
  true
);
```

### Step 2: Database - Create Sync Trigger (Prevent Future Issues)
Create a trigger that automatically creates a `vendor_riders` entry whenever `affiliated_vendor_id` is set on a rider profile.

```sql
CREATE OR REPLACE FUNCTION sync_rider_affiliation()
RETURNS TRIGGER AS $$
BEGIN
  -- When affiliated_vendor_id is set, ensure vendor_riders entry exists
  IF NEW.affiliated_vendor_id IS NOT NULL THEN
    INSERT INTO vendor_riders (vendor_id, rider_profile_id, invite_code, is_active)
    VALUES (NEW.affiliated_vendor_id, NEW.id, 'AUTO_SYNC', true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_rider_affiliation_change
  AFTER INSERT OR UPDATE OF affiliated_vendor_id ON rider_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_rider_affiliation();
```

### Step 3: Update VendorRiders Page Query
Modify the query to also check `rider_profiles.affiliated_vendor_id` as a fallback, and display user names properly.

**File: `src/pages/vendor/VendorRiders.tsx`**
- Update the rider fetch query to join with `profiles` table to get rider names
- Add fallback to check `rider_profiles.affiliated_vendor_id` for legacy affiliations

### Step 4: Update VendorRiderCard Component
Ensure the card displays rider information correctly including:
- Rider name (from profiles table)
- Verification status
- Online/offline status
- Performance stats

---

## Technical Details

### Database Changes
1. **One-time data fix**: Insert missing `vendor_riders` record for diptvnetwork
2. **New trigger**: Auto-sync `rider_profiles.affiliated_vendor_id` → `vendor_riders` table

### Frontend Changes
| File | Change |
|------|--------|
| `src/pages/vendor/VendorRiders.tsx` | Join with profiles to get rider names, improve data fetching |
| `src/components/vendor/VendorRiderCard.tsx` | Already updated - verify it displays correctly |

### RLS Considerations
- Existing policies on `vendor_riders` allow vendors to manage their own riders
- No new RLS changes needed

---

## Expected Result After Fix
When you visit `/vendor/riders` as Dlect food owner:
- You'll see diptvnetwork@gmail.com listed as an affiliated rider
- Their stats (orders, completed deliveries, your revenue share) will display
- Future orders delivered by this rider will credit 80% to vendor wallet

