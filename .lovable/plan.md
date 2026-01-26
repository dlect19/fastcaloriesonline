

# Plan: Fix Admin Data Visibility and Create Accounting Dashboard

## Overview

This plan addresses two main issues:
1. **Users and Riders Not Visible**: The frontend queries are failing due to invalid foreign key relationship hints
2. **Dashboard Needs Accounting Layout**: Restructure to separate commission, revenue, and payout data

---

## Problem Analysis

### Root Cause of Data Visibility Issue

The network logs show these errors:
- `Could not find a relationship between 'profiles' and 'user_roles'`
- `Could not find a relationship between 'rider_profiles' and 'profiles'`

**Why?** The queries use Supabase's foreign key syntax (`table!fk_name(columns)`) but there are NO foreign keys defined between these tables. The RLS policy we added works - the issue is the query structure itself.

### Current Dashboard Limitations

- Shows only basic counts (orders, vendors, riders, users)
- "Total Revenue" combines everything with no breakdown
- No commission tracking
- No payout/withdrawal data
- No separation of vendor vs platform earnings

---

## Task 1: Fix AdminUsers Query

**File**: `src/pages/admin/AdminUsers.tsx`

**Current Query (Broken)**:
```typescript
.from('profiles')
.select('*, user_roles(role)')  // FK doesn't exist
```

**Solution**: Fetch profiles first, then fetch roles separately and merge:
```typescript
// First get profiles
const { data: profilesData } = await supabase
  .from('profiles')
  .select('*')
  .order('created_at', { ascending: false });

// Then get all user roles
const { data: rolesData } = await supabase
  .from('user_roles')
  .select('user_id, role');

// Merge roles into profiles
const usersWithRoles = profilesData?.map(profile => ({
  ...profile,
  roles: rolesData?.filter(r => r.user_id === profile.user_id).map(r => r.role) || []
})) || [];
```

---

## Task 2: Fix AdminRiders Query

**File**: `src/pages/admin/AdminRiders.tsx`

**Current Query (Broken)**:
```typescript
.from('rider_profiles')
.select('*, profiles!rider_profiles_user_id_fkey(full_name, phone)')
```

**Solution**: Fetch rider_profiles first, then fetch related profiles:
```typescript
// Get rider profiles
const { data: riderData } = await supabase
  .from('rider_profiles')
  .select('*')
  .order('created_at', { ascending: false });

// Get profile info for each rider
const userIds = riderData?.map(r => r.user_id) || [];
const { data: profilesData } = await supabase
  .from('profiles')
  .select('user_id, full_name, phone')
  .in('user_id', userIds);

// Merge profile info into riders
const ridersWithProfiles = riderData?.map(rider => ({
  ...rider,
  profile: profilesData?.find(p => p.user_id === rider.user_id)
})) || [];
```

---

## Task 3: Redesign Admin Dashboard for Accounting

**File**: `src/pages/admin/AdminDashboard.tsx`

### New Dashboard Sections

#### Section 1: Platform Overview (Top Row)
| Card | Data |
|------|------|
| Total Orders | Count of all orders |
| Active Vendors | Count of verified vendors |
| Active Riders | Count of verified riders |
| Total Users | Count of all profiles |

#### Section 2: Revenue Breakdown (Financial Row)
| Card | Data | Calculation |
|------|------|-------------|
| Gross Revenue | Total order amounts | `SUM(orders.total)` |
| Platform Commission | Commission earned | `SUM(orders.subtotal * vendor.commission_rate)` |
| Delivery Revenue | Platform share of delivery | `SUM(delivery_fee * (100 - rider_share_pct) / 100)` |
| Service Fees | All service fees | `SUM(orders.service_fee)` |

#### Section 3: Payouts Section
| Card | Data |
|------|------|
| Total Payouts | Sum of completed payouts |
| Pending Payouts | Sum of pending withdrawal requests |
| Vendor Balances | Total eligible vendor wallet balances |
| Rider Balances | Total eligible rider wallet balances |

#### Section 4: Quick Stats
| Card | Data |
|------|------|
| Platform Wallet Balance | From `platform_wallet.balance` |
| Total Earned (All-time) | From `platform_wallet.total_earned` |
| Net Position | Balance - Pending Payouts |

### Data Fetching Strategy

```typescript
const fetchFinancialStats = async () => {
  // Fetch platform wallet
  const { data: platformWallet } = await supabase
    .from('platform_wallet')
    .select('*')
    .single();

  // Fetch order financial summary
  const { data: orders } = await supabase
    .from('orders')
    .select('total, subtotal, delivery_fee, service_fee, discount, vendor_id');

  // Fetch vendor commission rates
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, commission_rate');

  // Fetch payout summary
  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('amount, status');

  // Fetch wallet balances
  const { data: wallets } = await supabase
    .from('wallets')
    .select('wallet_type, eligible_balance, pending_balance');
    
  // Calculate metrics...
};
```

### UI Layout

```text
+--------------------------------------------------+
|  Platform Overview                                |
|  +--------+ +--------+ +--------+ +--------+     |
|  | Orders | |Vendors | | Riders | | Users  |     |
|  +--------+ +--------+ +--------+ +--------+     |
+--------------------------------------------------+

+--------------------------------------------------+
|  Revenue Breakdown                                |
|  +----------+ +------------+ +----------+ +------+
|  | Gross    | | Commission | | Delivery | |Fees  |
|  | Revenue  | | Earned     | | Revenue  | |      |
|  +----------+ +------------+ +----------+ +------+
+--------------------------------------------------+

+--------------------------------------------------+
|  Payouts & Balances                              |
|  +--------+ +--------+ +--------+ +--------+     |
|  | Total  | |Pending | | Vendor | | Rider  |     |
|  |Payouts | |Payouts | |Balances| |Balances|     |
|  +--------+ +--------+ +--------+ +--------+     |
+--------------------------------------------------+

+--------------------------------------------------+
|  Platform Financial Position                      |
|  +----------------+ +----------------+ +--------+ |
|  | Platform Wallet| | Total Earned   | | Net    | |
|  +----------------+ +----------------+ +--------+ |
+--------------------------------------------------+
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/admin/AdminUsers.tsx` | Fix query to use separate fetches and merge data |
| `src/pages/admin/AdminRiders.tsx` | Fix query to use separate fetches and merge data |
| `src/pages/admin/AdminDashboard.tsx` | Complete redesign with accounting sections |

---

## Expected Outcome

After implementation:
1. Admin Users page will display all 3 registered users with their roles
2. Admin Riders page will display the 1 registered rider with profile details
3. Dashboard will show:
   - Clear separation of revenue types (gross, commission, delivery, service fees)
   - Payout tracking (completed vs pending)
   - Wallet balances by type (vendor vs rider)
   - Platform financial position

---

## Technical Notes

- No database migrations needed - the data and RLS policies are already correct
- The fix is purely frontend query restructuring
- Commission calculation uses `vendors.commission_rate` (default 15%)
- Rider share uses `platform_settings.default_rider_share_percentage` (default 80%)

