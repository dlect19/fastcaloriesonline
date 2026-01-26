
# Plan: Fix Admin Dashboard Visibility and Missing Settings

## Overview
This plan addresses four issues: users not visible, riders not visible, missing commission settings, and missing promo code options. The root cause for visibility issues is RLS policies on the `profiles` table that don't allow admin access.

---

## Task 1: Fix RLS Policy for Admin Access to Profiles

**Problem**: The `profiles` table only allows users to view their own profile.

**Solution**: Add a new RLS SELECT policy allowing admins to view all profiles.

**Database Migration**:
```sql
-- Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
```

---

## Task 2: Fix RLS Policy for Admin Access to User Roles

**Problem**: Admins need to see user roles to display them in the users list.

**Solution**: The `user_roles` table already has an admin policy for ALL operations, so this should work. No changes needed here.

---

## Task 3: Add Commission Settings to Admin Settings Page

**File**: `src/pages/admin/AdminSettings.tsx`

**Changes**:
1. Add a new "Commission Settings" card section
2. Display and allow editing of:
   - `default_vendor_commission_rate` - Platform commission from vendors (%)
   - `default_rider_share_percentage` - Rider's share of delivery fee (%)
   - `min_withdrawal_amount` - Minimum withdrawal amount
   - `vendor_earnings_hold_hours` - Vendor earnings hold period
   - `rider_earnings_hold_hours` - Rider earnings hold period

**New UI Section**:
- Add a "Financial Settings" card below the delivery settings
- Include input fields for commission rates with percentage indicators
- Include input fields for hold hours and minimum withdrawal

---

## Task 4: Enhance Promo Codes Page with Scope and Per-User Limit

**File**: `src/pages/admin/AdminPromos.tsx`

**Changes**:
1. Add "Scope" selector in create dialog:
   - Options: "Platform-wide" or "Vendor-specific"
2. Add "Per User Limit" input field:
   - Limits how many times each customer can use the code
3. Display scope badge on promo list items
4. Show per-user limit info in the promo card

---

## Technical Details

### Files to Modify

| File | Changes |
|------|---------|
| Database Migration | Add RLS policy for admin profile access |
| `src/pages/admin/AdminSettings.tsx` | Add commission and financial settings section |
| `src/pages/admin/AdminPromos.tsx` | Add scope selector and per-user limit field |

### Commission Settings Config to Add

```typescript
const financialSettingsConfig = [
  { key: 'default_vendor_commission_rate', label: 'Vendor Commission Rate', unit: '%', description: 'Platform commission on vendor orders' },
  { key: 'default_rider_share_percentage', label: 'Rider Share', unit: '%', description: 'Rider share of delivery fee' },
  { key: 'min_withdrawal_amount', label: 'Min Withdrawal', unit: '₦', description: 'Minimum amount for withdrawals' },
  { key: 'vendor_earnings_hold_hours', label: 'Vendor Hold Period', unit: 'hrs', description: 'Hours to hold vendor earnings' },
  { key: 'rider_earnings_hold_hours', label: 'Rider Hold Period', unit: 'hrs', description: 'Hours to hold rider earnings' },
];
```

### Promo Form Enhancements

```typescript
// New state for promo form
const [scope, setScope] = useState('platform');
const [perUserLimit, setPerUserLimit] = useState('');

// Add to insert payload
{
  scope: scope,
  per_user_limit: perUserLimit ? parseInt(perUserLimit) : null,
}
```

---

## Expected Outcome

After implementation:
1. Admin can see all registered users in the Users page
2. Admin can see all riders with their profile details
3. Admin can configure vendor commission rates and rider shares
4. Admin can create platform-wide or vendor-specific promo codes with per-user limits

---

## Security Considerations

- The new RLS policy only grants SELECT (read) access to admins, not write
- Commission settings are protected by existing admin-only RLS on `platform_settings`
- Promo codes are already protected by admin RLS policies
