
# Fix: Paystack Recipient Environment Mismatch

## Problem Identified

The payout is failing because:
- **Recipient code** `RCP_24claviprp4yso6` was created on **January 26-27** when the platform was in **Test mode**
- **Platform switched** to **Production mode** on **February 1st**
- **Paystack Test recipients** are **NOT valid** for Live/Production transfers - they exist in completely separate environments

The error from Paystack confirms this:
```
"Recipient specified is invalid"
"nextStep": "Provide a valid recipient"
```

## Solution

We need to:
1. **Detect environment mismatch** and require users to re-add bank details when switching environments
2. **Track which environment** a recipient was created in
3. **Auto-detect stale recipients** and prompt users to update their bank details

## Technical Changes

### 1. Database: Add Environment Tracking to Recipients
Add a column to track which environment a recipient was created in:

```sql
ALTER TABLE paystack_recipients 
ADD COLUMN created_in_environment TEXT DEFAULT 'development';
```

### 2. Update `paystack-create-recipient` Edge Function
Save the current environment when creating recipients:

```typescript
// After creating recipient, include environment
const { data: recipient } = await supabase
  .from("paystack_recipients")
  .insert({
    // existing fields...
    created_in_environment: environment, // 'production' or 'development'
  })
```

### 3. Update `process-payout` Edge Function  
Check if recipient matches current environment before processing:

```typescript
// Check if recipient was created in current environment
if (recipientEnvironment !== currentEnvironment) {
  return new Response(
    JSON.stringify({ 
      success: false, 
      error: "Bank details need to be updated for production mode. Please re-add your bank account.",
      require_bank_update: true
    }),
    { status: 400 }
  );
}
```

### 4. Update Withdrawal Pages (Rider & Vendor)
Show a warning banner when bank details need updating for the current environment:

```typescript
// Check if recipient environment matches platform environment
const needsBankUpdate = recipient?.created_in_environment !== platformEnvironment;

{needsBankUpdate && (
  <Alert variant="destructive">
    Your bank details were set up in test mode. 
    Please update them to enable real withdrawals.
  </Alert>
)}
```

### 5. Immediate Data Fix
For the current rider, they need to:
1. Go to withdrawal settings
2. Remove/update their bank details
3. Re-add the same account - this will create a new recipient with the Live API key

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/` | Add `created_in_environment` column |
| `supabase/functions/paystack-create-recipient/index.ts` | Save environment when creating |
| `supabase/functions/process-payout/index.ts` | Validate recipient environment |
| `src/pages/rider/RiderWithdraw.tsx` | Show environment mismatch warning |
| `src/pages/vendor/VendorWithdraw.tsx` | Show environment mismatch warning |

## Immediate Workaround

**For this specific rider**, they need to re-add their bank details now that the platform is in production. This will create a new Paystack recipient with the Live API key, which will work for real transfers.
