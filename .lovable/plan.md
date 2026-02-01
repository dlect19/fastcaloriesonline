
# Dedicated Virtual Account (DVA) Implementation Plan

## Overview

This plan implements Paystack Dedicated Virtual Accounts (DVA) for customers. Each customer will get a unique bank account number that they can use to fund their wallet by making bank transfers. When a transfer is received, Paystack sends a webhook and the wallet is automatically credited.

---

## How It Works

1. **Customer Profile Requirement**: Customer must have `first_name`, `last_name`, and `phone` set in their profile
2. **Create Paystack Customer**: Register the customer with Paystack using their profile data
3. **Assign Virtual Account**: Create a dedicated NUBAN account linked to the Paystack customer
4. **Store Account Details**: Save the virtual account number in the database
5. **Receive Payments**: When customer transfers to the account, webhook credits their wallet

---

## Implementation Phases

### Phase 1: Database Schema Updates

Add columns to store Paystack customer and DVA information:

**Wallets Table Additions:**
- `paystack_customer_id` (integer) - Paystack customer ID
- `paystack_customer_code` (text) - Paystack customer code (e.g., CUS_xxx)
- `dva_bank_name` (text) - Bank name (e.g., "Wema Bank")
- `dva_account_number` (text) - Virtual account number
- `dva_account_name` (text) - Account name
- `dva_active` (boolean) - Whether DVA is active
- `dva_created_at` (timestamp) - When DVA was created

---

### Phase 2: Edge Functions

#### 2.1 `paystack-create-customer`
Register or update customer on Paystack.

**API Call:**
```
POST https://api.paystack.co/customer
{
  "email": "customer@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+2348123456789"
}
```

**Flow:**
1. Validate user has complete profile (first_name, last_name, phone)
2. Check if customer already exists on Paystack (by email)
3. If not, create customer on Paystack
4. Store `customer_id` and `customer_code` in wallet

#### 2.2 `paystack-create-dva`
Create dedicated virtual account for a validated customer.

**API Call:**
```
POST https://api.paystack.co/dedicated_account
{
  "customer": 481193,  // Paystack customer ID
  "preferred_bank": "wema-bank"
}
```

**Flow:**
1. Verify user has Paystack customer ID
2. Create DVA via Paystack API
3. Store account details in wallet
4. Return account number to display to user

#### 2.3 Update `paystack-webhook`
Handle DVA transfer events:
- `dedicatedaccount.assign.success` - DVA created
- `charge.success` with `channel: dedicated_nuban` - Transfer received

**Transfer Flow:**
1. Receive webhook with transfer details
2. Identify customer from account number
3. Credit customer wallet
4. Log transaction

---

### Phase 3: Frontend - Profile Completion Check

Update profile to require complete information before DVA creation:

**Required Fields:**
- Full Name (split into first_name/last_name)
- Phone Number

**UI Flow:**
1. Customer opens Wallet page
2. If DVA exists, show virtual account number
3. If no DVA but profile complete, show "Get Virtual Account" button
4. If profile incomplete, show prompt to update profile first

---

### Phase 4: Wallet Page Updates

Add DVA section to `WalletPage.tsx`:

**Features:**
- Display virtual account number prominently when available
- Copy account number button
- Bank name display
- "Create Virtual Account" button (when not yet created)
- Profile completion prompt (when profile incomplete)

---

### Phase 5: Webhook Integration

Update `paystack-webhook` to handle DVA transfers:

**Event: `charge.success` with `channel: dedicated_nuban`**
```json
{
  "event": "charge.success",
  "data": {
    "amount": 10000,
    "channel": "dedicated_nuban",
    "reference": "trx_xxx",
    "customer": {
      "customer_code": "CUS_xxx",
      "email": "customer@example.com"
    }
  }
}
```

**Handler Logic:**
1. Check if `channel === "dedicated_nuban"`
2. Find wallet by `paystack_customer_code`
3. Credit wallet balance
4. Log transaction with category `dva_funding`

---

## Technical Architecture

```text
Customer Profile                   Paystack API
[first_name, last_name, phone] --> POST /customer --> [customer_id, customer_code]
                                        |
                                        v
                               POST /dedicated_account
                                        |
                                        v
                               [bank_name, account_number, account_name]
                                        |
                                        v
                               Store in wallets table
                                        |
                                        v
                               Display to customer

Bank Transfer --> Paystack --> Webhook --> Credit Wallet
```

---

## File Changes Summary

### New Files:
| File | Purpose |
|------|---------|
| `supabase/functions/paystack-create-customer/index.ts` | Create/get Paystack customer |
| `supabase/functions/paystack-create-dva/index.ts` | Create dedicated virtual account |
| `src/components/profile/VirtualAccountCard.tsx` | Display DVA details |
| `src/components/profile/CreateDVADialog.tsx` | DVA creation flow |

### Modified Files:
| File | Changes |
|------|---------|
| `supabase/functions/paystack-webhook/index.ts` | Handle DVA transfer events |
| `src/pages/profile/WalletPage.tsx` | Add DVA section |
| `src/hooks/useCustomerWallet.ts` | Add DVA data fields |
| `src/components/profile/ProfileForm.tsx` | Split full_name into first/last for Paystack |
| `supabase/config.toml` | Register new edge functions |

### Database Changes:
| Type | Description |
|------|-------------|
| Migration | Add DVA columns to wallets table |

---

## Wallet Page Flow

```text
WalletPage
    |
    +---> [Has DVA?]
    |         |
    |         Yes --> Show Virtual Account Card
    |                 - Bank: Wema Bank
    |                 - Account Number: 1234567890
    |                 - Account Name: FASTCALORIES/JOHN DOE
    |                 - Copy button
    |
    +---> [No DVA, Profile Complete?]
    |         |
    |         Yes --> "Get Virtual Account" Button
    |                 - Opens CreateDVADialog
    |                 - Creates customer, then DVA
    |
    +---> [Profile Incomplete?]
              |
              --> Show prompt: "Complete your profile to get a virtual account"
                  - Link to profile edit
```

---

## Edge Function: paystack-create-customer

```text
Input: User token (from auth header)

Steps:
1. Get user profile (full_name, phone)
2. Parse first_name/last_name from full_name
3. Check if paystack_customer_code exists in wallet
   - If yes, return existing customer data
4. Call Paystack POST /customer
5. Store customer_id and customer_code in wallet
6. Return customer data

Response:
{
  success: true,
  customer_id: 481193,
  customer_code: "CUS_xxx"
}
```

---

## Edge Function: paystack-create-dva

```text
Input: User token (from auth header)

Steps:
1. Get wallet with paystack_customer_id
   - If not found, return error (must create customer first)
2. Check if DVA already exists (dva_account_number)
   - If yes, return existing DVA
3. Call Paystack POST /dedicated_account
4. Store DVA details in wallet
5. Return account details

Response:
{
  success: true,
  bank_name: "Wema Bank",
  account_number: "1234567890",
  account_name: "FASTCALORIES/JOHN DOE"
}
```

---

## Webhook Handler: DVA Transfer

```text
Event: charge.success
Channel: dedicated_nuban

Steps:
1. Extract customer_code from event data
2. Find wallet by paystack_customer_code
3. Check for duplicate (paystack_reference)
4. Credit wallet (balance or test_balance based on environment)
5. Insert wallet_transaction with:
   - category: "dva_funding"
   - notes: "Bank transfer funding"
6. Log success

Note: Paystack DVA works in production only (not test mode)
```

---

## Profile Name Handling

Current: `full_name` (single field)
Required: `first_name` and `last_name` (separate for Paystack)

**Approach:**
1. Parse full_name by splitting on first space
2. First word = first_name, remainder = last_name
3. For DVA creation, validate both parts exist

Example:
- "John Doe" → first_name: "John", last_name: "Doe"
- "Mary Jane Watson" → first_name: "Mary", last_name: "Jane Watson"

---

## Security Considerations

1. **Webhook Verification**: Use existing Paystack signature verification
2. **Idempotency**: Check `paystack_reference` before crediting
3. **User Validation**: Only authenticated users can create DVA
4. **Environment Awareness**: DVA works in production only; show appropriate message in development

---

## Testing Checklist

1. Create customer on Paystack with profile data
2. Create dedicated virtual account
3. Verify account details are stored correctly
4. Display account number on wallet page
5. Simulate webhook for DVA transfer
6. Verify wallet is credited correctly
7. Test duplicate transfer prevention
8. Test profile incomplete handling
9. Test environment mode handling (DVA is production-only)
