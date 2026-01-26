
# Bank Account Verification System with Environment-Aware Paystack Keys

## Overview
This plan implements a proper bank account verification flow for vendors and riders that dynamically fetches Nigerian banks from Paystack and auto-verifies account details. The system will use the correct Paystack keys (test/live) based on the platform environment.

## Current Issues

1. **Static Bank List**: Using a hardcoded array of 20 bank names without bank codes
2. **Manual Account Name Entry**: Users type their own account name (error-prone, no verification)
3. **No Environment Awareness**: Existing `paystack-verify-bank` and `paystack-create-recipient` functions use a single `PAYSTACK_SECRET_KEY` regardless of environment
4. **Missing Bank API Integration**: The Paystack `/bank` endpoint to fetch banks is not implemented

## Solution Architecture

```text
User Flow:
┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ Select Bank  │────>│ Enter Account #  │────>│ Auto-Verify & Save │
│ (from API)   │     │ (10 digits)      │     │ (resolved name)    │
└──────────────┘     └──────────────────┘     └────────────────────┘
       │                     │                        │
       v                     v                        v
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│ paystack-list-   │   │ paystack-verify- │   │ paystack-create-     │
│ banks            │   │ bank             │   │ recipient            │
│ (environment-    │   │ (environment-    │   │ (environment-aware)  │
│ aware)           │   │ aware)           │   │                      │
└──────────────────┘   └──────────────────┘   └──────────────────────┘
```

## Implementation Details

### Phase 1: Create New Edge Function for Bank List

**New File: `supabase/functions/paystack-list-banks/index.ts`**

This function will:
- Fetch platform environment from database
- Select the correct Paystack secret key (test or live)
- Call `GET https://api.paystack.co/bank`
- Return filtered list with bank name, code, and type
- Cache results to reduce API calls

Response format:
```typescript
{
  success: true,
  data: [
    { name: "Access Bank", code: "044", type: "nuban" },
    { name: "Zenith Bank", code: "057", type: "nuban" },
    // ... all Nigerian banks
  ]
}
```

### Phase 2: Update Existing Edge Functions for Environment Awareness

**Update: `supabase/functions/paystack-verify-bank/index.ts`**

Changes needed:
- Add environment detection using `platform_settings` table
- Select key dynamically:
  ```typescript
  const key = environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY")
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY");
  ```
- Call `GET https://api.paystack.co/bank/resolve?account_number=X&bank_code=Y`
- Return verified account name

**Update: `supabase/functions/paystack-create-recipient/index.ts`**

Same environment-aware key selection pattern to create Paystack recipients with the correct API key.

### Phase 3: Create Reusable Bank Account Form Component

**New File: `src/components/BankAccountForm.tsx`**

A shared component used by both vendor and rider withdrawal pages:

Features:
- Fetches bank list on mount using `paystack-list-banks`
- Searchable bank dropdown (with bank codes stored internally)
- Account number input (10-digit validation)
- Auto-verify button that calls `paystack-verify-bank`
- Displays resolved account name (read-only)
- Save button calls `paystack-create-recipient`

UI Flow:
1. User selects bank from searchable dropdown
2. User enters 10-digit account number
3. User clicks "Verify Account"
4. System auto-fills account name from Paystack
5. User confirms and saves

### Phase 4: Update Withdrawal Pages

**Update: `src/pages/vendor/VendorWithdraw.tsx`**
**Update: `src/pages/rider/RiderWithdraw.tsx`**

Changes:
- Remove hardcoded `NIGERIAN_BANKS` array
- Replace bank dialog content with new `BankAccountForm` component
- Pass appropriate callbacks for success/error handling

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/paystack-list-banks/index.ts` | Fetch banks from Paystack API with environment-aware keys |
| `src/components/BankAccountForm.tsx` | Reusable bank account verification form |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/paystack-verify-bank/index.ts` | Add environment-aware key selection |
| `supabase/functions/paystack-create-recipient/index.ts` | Add environment-aware key selection |
| `src/pages/vendor/VendorWithdraw.tsx` | Use new BankAccountForm component |
| `src/pages/rider/RiderWithdraw.tsx` | Use new BankAccountForm component |
| `supabase/config.toml` | Add new function configuration |

## Technical Details

### Environment Key Selection Pattern

All Paystack edge functions will use this helper:

```typescript
async function getPaystackSecretKey(supabase: SupabaseClient): Promise<string> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = envSetting?.value || "development";
  
  return environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY")!;
}
```

### BankAccountForm Component Props

```typescript
interface BankAccountFormProps {
  onSuccess: (data: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    recipientCode: string;
  }) => void;
  onCancel: () => void;
  existingBank?: string;
  existingAccountNumber?: string;
}
```

### Paystack API Responses

**List Banks Response:**
```json
{
  "status": true,
  "data": [
    { "name": "Access Bank", "code": "044", "type": "nuban", "active": true }
  ]
}
```

**Resolve Account Response:**
```json
{
  "status": true,
  "data": {
    "account_number": "0001234567",
    "account_name": "Doe Jane Loren"
  }
}
```

## Security Considerations

1. **Environment Isolation**: Test keys only work with test accounts; live keys with real accounts
2. **Server-side Verification**: Account names come directly from Paystack, preventing user manipulation
3. **Input Validation**: 10-digit account number validation before API calls
4. **Authentication Required**: All edge functions require valid user authentication

## Expected Outcome

After implementation:
1. Vendors/riders see a complete list of Nigerian banks from Paystack API
2. After entering account number, system auto-verifies and shows the actual account name
3. Verified accounts are saved as Paystack recipients
4. All operations use the correct keys based on platform environment (test vs live)
5. In development mode, test bank accounts can be used for testing
6. In production mode, real bank accounts work with live Paystack keys
