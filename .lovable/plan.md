

# Vendor Payout Integration Plan

## Problem Analysis

The platform currently has **two separate tables** for withdrawal requests:

1. **`payout_requests`** - Used by **riders**, integrated with admin approval and Paystack transfer processing
2. **`withdrawal_requests`** - Used by **vendors**, NOT integrated with admin panel or Paystack processing

Currently, 2 vendor withdrawal requests are pending in `withdrawal_requests` but are invisible to admins and cannot be processed.

---

## Solution Overview

Unify the vendor withdrawal flow to use the same `payout_requests` table and admin approval workflow as riders. This involves:

1. Updating the vendor withdrawal page to submit to `payout_requests`
2. Ensuring the admin payout dashboard shows both rider AND vendor requests (already does since both use same table)
3. The `process-payout` edge function already handles both user types

---

## Technical Changes

### 1. Update Vendor Withdraw Page

**File:** `src/pages/vendor/VendorWithdraw.tsx`

Changes needed:

- Replace `withdrawal_requests` table with `payout_requests` table in the submit function
- Update the fetch for withdrawal history to use `payout_requests`
- Match the data structure used by riders (same columns)

**Current Code (line ~317-327):**
```typescript
const { error } = await supabase
  .from('withdrawal_requests')  // Wrong table
  .insert({
    wallet_id: wallet!.id,
    user_id: user?.id,
    amount,
    bank_name: wallet!.bank_name,
    bank_account_number: wallet!.bank_account_number,
    bank_account_name: wallet!.bank_account_name || '',
    user_type: 'vendor',
  });
```

**Updated Code:**
```typescript
const { error } = await supabase
  .from('payout_requests')  // Correct table
  .insert({
    wallet_id: wallet!.id,
    user_id: user?.id,
    amount,
    bank_name: wallet!.bank_name,
    bank_account_number: wallet!.bank_account_number,
    bank_account_name: wallet!.bank_account_name || '',
    user_type: 'vendor',
    status: 'pending',  // Explicit status
  });
```

**Current fetch (line ~167-174):**
```typescript
const { data: withdrawalData } = await supabase
  .from('withdrawal_requests')
  .select('*')
  .eq('wallet_id', walletData.id)
  .order('requested_at', { ascending: false })
  .limit(20);
```

**Updated fetch:**
```typescript
const { data: payoutData } = await supabase
  .from('payout_requests')
  .select('*')
  .eq('wallet_id', walletData.id)
  .order('created_at', { ascending: false })
  .limit(20);

// Map to expected format
setWithdrawals((payoutData || []).map(p => ({
  id: p.id,
  amount: p.amount,
  status: p.status || 'pending',
  requested_at: p.created_at,
  processed_at: p.processed_at,
  notes: p.failure_reason,
})));
```

---

### 2. Migrate Existing Vendor Requests (Optional Data Migration)

There are 2 pending vendor withdrawals in the old table. After implementation, you can run a one-time SQL migration to move them:

```sql
INSERT INTO payout_requests (wallet_id, user_id, user_type, amount, status, bank_name, bank_account_number, bank_account_name, created_at)
SELECT wallet_id, user_id, user_type, amount, status, bank_name, bank_account_number, bank_account_name, requested_at
FROM withdrawal_requests
WHERE status = 'pending';
```

---

## Verification Checklist

After implementation:
- Vendors can submit withdrawal requests
- Requests appear in Admin Payouts page under "Pending"
- Admin can Approve/Reject vendor payouts
- Admin can Retry failed vendor payouts
- Success emails are sent to vendors when payout completes

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/vendor/VendorWithdraw.tsx` | Switch from `withdrawal_requests` to `payout_requests` table |

---

## Summary

This is a simple but critical fix that unifies the payout workflow. Both riders and vendors will:
1. Submit withdrawal requests to `payout_requests` table
2. Appear in the unified Admin Payouts dashboard
3. Be processed through the same `process-payout` edge function
4. Receive success/failure email notifications

