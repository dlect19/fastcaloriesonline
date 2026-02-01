
# Customer Virtual Wallet Implementation Plan

## Overview

This plan implements a customer virtual wallet system that allows customers to fund their wallet via Paystack, pay for orders using wallet balance, and receive refunds into their wallet. The wallet is an internal ledger-based system that integrates with the existing `wallets` and `wallet_transactions` tables.

---

## Current State Analysis

The project already has a robust wallet infrastructure:
- **`wallets` table**: Supports multiple wallet types (`customer`, `vendor`, `rider`) with columns for `balance`, `pending_balance`, `eligible_balance`, etc.
- **`wallet_transactions` table**: Comprehensive transaction ledger with categories like `vendor_share`, `rider_share`, `platform_commission`
- **Paystack integration**: Edge functions for payment initialization, verification, and webhooks
- **TransactionHistory component**: Reusable UI for viewing wallet transactions

---

## Implementation Phases

### Phase 1: Database Schema Updates

**New transaction categories needed:**
- `wallet_funding` - When customer adds money to wallet
- `wallet_payment` - When customer pays for order using wallet
- `refund` - When customer receives refund

**New RLS policies:**
- Allow customers to view their own wallet
- Allow customers to view their own wallet transactions

```sql
-- Update wallet_transactions RLS to allow customers to view their transactions
CREATE POLICY "Users can view own wallet transactions"
ON wallet_transactions FOR SELECT
USING (wallet_id IN (
  SELECT id FROM wallets WHERE user_id = auth.uid()
));
```

---

### Phase 2: Edge Functions

#### 2.1 `paystack-initialize-wallet-funding`
Initialize a Paystack transaction specifically for wallet funding.

**Flow:**
1. Customer requests to add ₦X to wallet
2. Initialize Paystack transaction with metadata: `{ type: "wallet_funding", user_id: "..." }`
3. Return authorization URL for payment

#### 2.2 Update `paystack-webhook`
Extend the existing webhook handler to process wallet funding:

**On `charge.success` with `type: wallet_funding`:**
1. Verify transaction hasn't been processed (idempotency check)
2. Credit customer's wallet balance
3. Log transaction in `wallet_transactions` with category `wallet_funding`

#### 2.3 `process-wallet-payment` (new)
Process order payment using wallet balance:

**Flow:**
1. Validate wallet balance >= order total
2. Debit customer wallet
3. Log transaction with category `wallet_payment`
4. Credit vendor/rider/platform wallets (use existing split logic)
5. Update order payment status

#### 2.4 `process-refund` (new)
Process refund to customer wallet:

**Flow:**
1. Verify order is eligible for refund
2. Credit customer wallet
3. Log transaction with category `refund`
4. Reverse vendor/rider credits if applicable

---

### Phase 3: Frontend - Customer Wallet Page

Create `src/pages/profile/WalletPage.tsx`:

**Features:**
- Display current wallet balance
- "Add Money" button → Opens funding modal
- Transaction history (reuse `TransactionHistory` component)
- Wallet balance shown prominently

**Add Money Modal:**
- Amount input with preset buttons (₦1000, ₦2000, ₦5000, ₦10000)
- Custom amount field
- "Fund Wallet" button → Redirects to Paystack

---

### Phase 4: Checkout Integration

Update `src/pages/Cart.tsx` to support wallet payment:

**New checkout options:**
1. **Pay with Wallet** - If wallet balance >= total
2. **Pay with Paystack** - Direct card/bank payment
3. **Pay with Wallet + Paystack** (optional) - Use partial wallet balance

**UI Changes:**
- Show wallet balance in checkout
- Payment method selector (Wallet / Card)
- If insufficient balance, show option to top up or pay difference

---

### Phase 5: Admin Controls

Create `src/pages/admin/AdminCustomerWallets.tsx`:

**Features:**
- List all customer wallets with balances
- Search by customer name/email
- View transaction history for any wallet
- Manual credit/debit form (with notes)
- Disable wallet toggle for fraud cases

---

## Technical Architecture

```text
+------------------+     +----------------------+     +-------------------+
|   Cart.tsx       |     | paystack-initialize- |     | Paystack API      |
| (Payment Method) | --> | wallet-funding       | --> | (Process Payment) |
+------------------+     +----------------------+     +-------------------+
                                                              |
                                                              v
+------------------+     +----------------------+     +-------------------+
|  WalletPage.tsx  |     | paystack-webhook     |     | wallet_transactions|
| (View Balance)   | <-- | (Credit Wallet)      | <-- | (Ledger Entry)    |
+------------------+     +----------------------+     +-------------------+
```

---

## Security Measures

1. **Backend-only balance modifications** - All wallet credits/debits happen in edge functions
2. **Webhook signature verification** - Use existing Paystack signature validation
3. **Unique transaction references** - Prevent duplicate credits using `paystack_reference`
4. **Idempotency checks** - Check for existing transactions before processing
5. **Non-negative balance constraint** - Validate balance before debits
6. **RLS policies** - Customers can only view their own wallet/transactions

---

## File Changes Summary

### New Files:
| File | Purpose |
|------|---------|
| `src/pages/profile/WalletPage.tsx` | Customer wallet dashboard |
| `src/components/profile/FundWalletDialog.tsx` | Modal for adding funds |
| `src/components/cart/PaymentMethodSelector.tsx` | Choose wallet/card payment |
| `supabase/functions/paystack-initialize-wallet-funding/index.ts` | Initialize wallet top-up |
| `supabase/functions/process-wallet-payment/index.ts` | Pay for order with wallet |
| `supabase/functions/process-refund/index.ts` | Process refunds to wallet |
| `src/pages/admin/AdminCustomerWallets.tsx` | Admin wallet management |
| `src/hooks/useCustomerWallet.ts` | Hook for wallet operations |

### Modified Files:
| File | Changes |
|------|---------|
| `supabase/functions/paystack-webhook/index.ts` | Handle `wallet_funding` type |
| `src/pages/Cart.tsx` | Add payment method selector, wallet payment option |
| `src/pages/Profile.tsx` | Add link to wallet page |
| `src/App.tsx` | Add wallet route |
| `src/components/shared/TransactionHistory.tsx` | Add new category labels |
| `src/components/admin/AdminSidebar.tsx` | Add customer wallets link |

### Database Changes:
| Type | Description |
|------|-------------|
| RLS Policy | Customer wallet transaction viewing |
| Migration | Add `is_disabled` column to wallets table |

---

## Checkout Flow Summary

```text
Customer at Checkout
        |
        v
[Show Wallet Balance: ₦5,000]
[Order Total: ₦3,500]
        |
        +---> [Pay with Wallet] --> Deduct from wallet --> Order Confirmed
        |
        +---> [Pay with Card] --> Paystack checkout --> Order Confirmed
        |
        +---> [Wallet + Card] --> Deduct wallet, pay remainder via Paystack
```

---

## Refund Handling

**Automated refunds for:**
- Cancelled orders (by vendor before preparation)
- Failed deliveries

**Refund process:**
1. Admin/system triggers refund via edge function
2. Credit customer wallet with refund amount
3. Log transaction with category `refund` and order reference
4. (Optional) Reverse vendor/rider credits

**No bank transfers** - Refunds stay in wallet for future purchases

---

## Admin Wallet Management

**Capabilities:**
1. View all customer wallets with search/filter
2. View transaction history for any customer
3. Manual credit (for disputes/compensation)
4. Manual debit (for chargebacks)
5. Disable wallet (fraud prevention)
6. All manual adjustments require notes and are logged

---

## Testing Checklist

1. Fund wallet via Paystack (test mode)
2. Verify webhook credits wallet correctly
3. Pay for order using wallet balance
4. Verify wallet debited and order confirmed
5. Test insufficient balance handling
6. Test partial wallet + card payment
7. Test refund flow
8. Verify admin can view/manage wallets
9. Test duplicate payment prevention
10. Verify RLS policies work correctly
