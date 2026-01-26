
# Implementation Plan: Development/Production Environment Separation

## Overview

This plan implements a robust environment separation system for Fast Calories that ensures safe testing with Paystack test keys while preventing test data from ever appearing in production.

---

## Architecture Summary

```text
+-------------------+      +-------------------+
|   DEVELOPMENT     |      |    PRODUCTION     |
|   ENVIRONMENT     |      |    ENVIRONMENT    |
+-------------------+      +-------------------+
|                   |      |                   |
| Paystack TEST     |      | Paystack LIVE     |
| Public Key        |      | Public Key        |
| Paystack TEST     |      | Paystack LIVE     |
| Secret Key        |      | Secret Key        |
|                   |      |                   |
| Test Vendors      |      | Approved Vendors  |
| Test Riders       |      | Verified Riders   |
| Test Transactions |      | Real Transactions |
|                   |      |                   |
| No Real Payouts   |      | Real Bank Payouts |
+-------------------+      +-------------------+
```

---

## Database Changes

### 1. Add Environment Column to Key Tables

**Vendors Table:**
- Add `is_test_store` (boolean, default: false)
- Add `approved_for_live` (boolean, default: false)

**Rider Profiles Table:**
- Add `is_test_rider` (boolean, default: false)

**Orders Table:**
- Add `environment` (text: 'development' | 'production', default: 'production')

**Wallet Transactions Table:**
- Add `environment` (text: 'development' | 'production', default: 'production')

**Wallets Table:**
- Add `test_balance` (numeric, default: 0)
- Add `test_pending_balance` (numeric, default: 0)
- Add `test_eligible_balance` (numeric, default: 0)

**Platform Wallet Table:**
- Add `test_balance` (numeric, default: 0)

### 2. New Platform Settings

Add new settings to `platform_settings` table:
- `platform_environment` = 'development' | 'production'
- `paystack_test_public_key` = (stored in secrets)
- `paystack_live_public_key` = (stored in secrets)

### 3. New Environment Switch Logs Table

Create `environment_switch_logs` table:
- `id` (uuid)
- `switched_by` (uuid, references auth.users)
- `from_environment` (text)
- `to_environment` (text)
- `confirmation_text` (text)
- `ip_address` (text)
- `created_at` (timestamp)

---

## Secret Management

### New Secrets Required

| Secret Name | Description |
|-------------|-------------|
| PAYSTACK_TEST_SECRET_KEY | Paystack test secret key |
| PAYSTACK_TEST_PUBLIC_KEY | Paystack test public key |
| PAYSTACK_LIVE_SECRET_KEY | Paystack live secret key (rename current) |
| PAYSTACK_LIVE_PUBLIC_KEY | Paystack live public key |

### Edge Function Key Selection Logic

```typescript
// In each Paystack edge function
const platformEnv = await getPlatformEnvironment(supabase);
const PAYSTACK_SECRET_KEY = platformEnv === 'development'
  ? Deno.env.get("PAYSTACK_TEST_SECRET_KEY")
  : Deno.env.get("PAYSTACK_LIVE_SECRET_KEY");
```

---

## Edge Function Updates

### 1. Create `get-platform-config` Edge Function

Returns the current platform environment and appropriate public key:

```typescript
// Returns:
{
  environment: 'development' | 'production',
  paystackPublicKey: 'pk_test_xxx' | 'pk_live_xxx'
}
```

### 2. Update `paystack-initialize-payment`

- Check platform environment
- Use appropriate secret key
- Block test transactions in production
- Add `environment` to order metadata

### 3. Update `paystack-webhook`

- Verify webhook comes from correct environment
- Update test balances in development mode
- Update real balances in production mode
- Block real money movement in development

### 4. Update `process-payout`

- Check platform environment
- **BLOCK ALL PAYOUTS in development mode**
- Only allow real transfers in production

### 5. Update `paystack-verify-bank`

- Works in both environments (same API)

---

## Frontend Changes

### 1. Create Environment Config Hook

**File: `src/hooks/useEnvironmentConfig.ts`**

```typescript
export function useEnvironmentConfig() {
  // Fetches current environment from edge function
  // Returns { environment, paystackPublicKey, isTestMode }
}
```

### 2. Update Admin Settings Page

**File: `src/pages/admin/AdminSettings.tsx`**

Add new "Environment" section:
- Current environment indicator (badge)
- Switch environment button (super_admin only)
- Confirmation modal with typed confirmation
- Environment switch history log

### 3. Update Admin Vendors Page

**File: `src/pages/admin/AdminVendors.tsx`**

Add features:
- "Test Store" badge on vendor cards
- Toggle to mark vendor as test store
- Filter tabs: All | Test | Live
- "Approve for Live" action button

### 4. Update Admin Riders Page

**File: `src/pages/admin/AdminRiders.tsx`**

Add features:
- "Test Rider" badge on rider cards
- Toggle to mark rider as test rider
- Filter tabs: All | Test | Live

### 5. Update Home Page Vendor Filtering

**File: `src/components/home/VendorGrid.tsx`**

Add environment-aware filtering:
```typescript
// In development: show only test stores
// In production: show only approved live stores
```

### 6. Add Environment Banner

**File: `src/components/EnvironmentBanner.tsx`**

Sticky warning banner when in development mode:
- Yellow background
- "TEST MODE - Transactions are simulated"
- Only visible to authenticated users

---

## RLS Policy Updates

### Vendors Table

```sql
-- Customers can only see vendors matching current environment
CREATE POLICY "Filter vendors by environment" ON public.vendors
FOR SELECT USING (
  -- Admins see all
  has_role(auth.uid(), 'admin') OR
  -- In production: only non-test approved stores
  (get_platform_environment() = 'production' AND is_test_store = false AND approved_for_live = true AND is_active = true) OR
  -- In development: only test stores
  (get_platform_environment() = 'development' AND is_test_store = true AND is_active = true)
);
```

---

## Security Controls

### Environment Switch Requirements

1. **Super Admin Only** - Only `super_admin` role can switch
2. **Typed Confirmation** - Must type "I confirm this will enable real payments"
3. **Audit Logging** - Every switch logged with user, timestamp, IP
4. **Cooldown Period** - 5-minute delay before switch takes effect
5. **Notification** - Alert sent to all super admins on switch

### Data Isolation Rules

| Data Type | In Development | In Production |
|-----------|----------------|---------------|
| Test Stores | Visible | Hidden |
| Live Stores | Hidden | Visible |
| Test Transactions | Recorded | Blocked |
| Real Payments | Blocked | Enabled |
| Bank Payouts | Simulated | Real |

---

## Implementation Order

### Phase 1: Database Setup
1. Add columns to vendors, riders, orders, wallets tables
2. Create environment_switch_logs table
3. Add platform environment settings
4. Create `get_platform_environment()` database function

### Phase 2: Secrets & Edge Functions
1. Add new Paystack secrets (test keys)
2. Create `get-platform-config` edge function
3. Update `paystack-initialize-payment`
4. Update `paystack-webhook`
5. Update `process-payout`

### Phase 3: Admin UI
1. Add environment section to AdminSettings
2. Update AdminVendors with test store management
3. Update AdminRiders with test rider management
4. Add environment switch confirmation modal

### Phase 4: Customer-Facing Changes
1. Create useEnvironmentConfig hook
2. Add EnvironmentBanner component
3. Update VendorGrid filtering
4. Test complete flow in both modes

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/useEnvironmentConfig.ts` | Hook to get current environment |
| `src/components/EnvironmentBanner.tsx` | Warning banner for test mode |
| `src/components/admin/EnvironmentSwitch.tsx` | Environment toggle UI |
| `src/components/admin/EnvironmentSwitchConfirmation.tsx` | Confirmation modal |
| `supabase/functions/get-platform-config/index.ts` | Returns environment config |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/admin/AdminSettings.tsx` | Add environment section |
| `src/pages/admin/AdminVendors.tsx` | Add test store management |
| `src/pages/admin/AdminRiders.tsx` | Add test rider management |
| `src/components/home/VendorGrid.tsx` | Environment-aware filtering |
| `supabase/functions/paystack-initialize-payment/index.ts` | Dynamic key selection |
| `supabase/functions/paystack-webhook/index.ts` | Environment-aware processing |
| `supabase/functions/process-payout/index.ts` | Block payouts in dev mode |
| `supabase/functions/paystack-verify-bank/index.ts` | Works in both modes |

---

## Testing Checklist

- [ ] Super admin can switch between environments
- [ ] Confirmation required for production switch
- [ ] Test stores only visible in development
- [ ] Live stores only visible in production
- [ ] Test payments use test keys
- [ ] Real payments blocked in development
- [ ] Payouts blocked in development
- [ ] Environment switch is logged
- [ ] Test mode banner appears

---

## Expected Outcome

A platform that:
1. Safely separates development and production
2. Uses Paystack test keys in development
3. Uses Paystack live keys in production
4. Prevents test data from appearing live
5. Blocks real money movement during testing
6. Requires explicit super admin confirmation
7. Logs all environment changes
8. Scales from MVP to production safely
