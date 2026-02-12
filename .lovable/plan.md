
# Fix: Vendor Wallet Balance Reconciliation

## Problem
The `menu_earnings_balance` column shows ₦5,362.50 but should be ₦1,635 based on the transaction ledger. We corrected it earlier to ₦262.50, but the `release_pending_vendor_earnings` cron job (runs every 2 minutes) and other triggers re-corrupted it by applying incremental updates that don't account for the correction.

Six different database triggers independently modify wallet balance columns (`menu_earnings_balance`, `balance`, `eligible_balance`, etc.), making manual corrections fragile:
1. `credit_vendor_on_payment` -- adds to pending
2. `update_vendor_revenue_pools` -- adds to menu_earnings_pending
3. `release_pending_vendor_earnings` -- moves pending to balance
4. `reverse_financials_on_cancellation` -- reverses on cancel
5. `deduct_wallet_on_payout_request` -- deducts on withdrawal
6. `restore_wallet_on_payout_failure` -- restores on failed withdrawal

## Solution

### Step 1: Create a Reconciliation Function
Build a `reconcile_vendor_wallet(wallet_uuid)` database function that **recalculates all wallet columns from the transaction ledger** (the single source of truth), rather than relying on incremental trigger updates.

It will compute:
- `menu_earnings_balance` = SUM(completed vendor_share credits) - SUM(completed vendor_share debits) - SUM(menu withdrawal debits) + SUM(menu withdrawal_reversal credits)
- `rider_revenue_balance` = SUM(vendor_rider_share credits) - SUM(vendor_rider_share debits) - SUM(rider_revenue withdrawal debits) + SUM(rider_revenue withdrawal_reversal credits)
- `balance` = menu_earnings_balance + rider_revenue_balance
- `eligible_balance` = balance (since 0hr hold means all released funds are eligible)
- `pending_balance` = SUM(pending vendor_share credits)
- `menu_earnings_pending` = pending_balance
- `total_earned` = SUM(all completed vendor_share + vendor_rider_share credits) - SUM(their debits)

### Step 2: Run Reconciliation for the Affected Vendor
Execute the function to correct the current wallet state.

### Step 3: Compute UI Values from Ledger (Code Change)
Update `VendorEarnings.tsx` to compute `menu_earnings_balance` dynamically from wallet_transactions rather than trusting the wallet column. This ensures the UI is always accurate regardless of trigger drift.

The page already fetches wallet_transactions for the transaction history -- we'll reuse that data to compute the balances shown in the "Menu Sales Revenue" and "Rider Delivery Revenue" cards.

## Technical Details

### Database Migration (SQL)
```sql
CREATE OR REPLACE FUNCTION reconcile_vendor_wallet(p_wallet_id UUID)
RETURNS void AS $$
DECLARE
  v_menu_balance NUMERIC;
  v_menu_pending NUMERIC;
  v_rider_balance NUMERIC;
  v_pending_bal NUMERIC;
  v_total_earned NUMERIC;
BEGIN
  -- Menu earnings balance (released - cancelled - withdrawn + reversed)
  SELECT COALESCE(SUM(CASE 
    WHEN category = 'vendor_share' AND transaction_type = 'credit' AND status = 'completed' THEN amount
    WHEN category = 'vendor_share' AND transaction_type = 'debit' AND status = 'completed' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND notes LIKE '%Menu Earnings%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND notes LIKE '%Menu Earnings%' THEN amount
    ELSE 0
  END), 0) INTO v_menu_balance
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  -- Menu pending
  SELECT COALESCE(SUM(amount), 0) INTO v_menu_pending
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production'
    AND category = 'vendor_share' AND transaction_type = 'credit' AND status = 'pending';

  -- Rider revenue balance
  SELECT COALESCE(SUM(CASE
    WHEN category = 'vendor_rider_share' AND transaction_type = 'credit' THEN amount
    WHEN category = 'vendor_rider_share' AND transaction_type = 'debit' THEN -amount
    WHEN category = 'withdrawal' AND transaction_type = 'debit' AND notes LIKE '%Rider Revenue%' THEN -amount
    WHEN category = 'withdrawal_reversal' AND transaction_type = 'credit' AND notes LIKE '%Rider Revenue%' THEN amount
    ELSE 0
  END), 0) INTO v_rider_balance
  FROM wallet_transactions
  WHERE wallet_id = p_wallet_id AND environment = 'production';

  v_total_earned := v_menu_balance + v_menu_pending + v_rider_balance;

  UPDATE wallets SET
    menu_earnings_balance = GREATEST(v_menu_balance, 0),
    menu_earnings_pending = GREATEST(v_menu_pending, 0),
    rider_revenue_balance = GREATEST(v_rider_balance, 0),
    balance = GREATEST(v_menu_balance + v_rider_balance, 0),
    eligible_balance = GREATEST(v_menu_balance + v_rider_balance, 0),
    pending_balance = GREATEST(v_menu_pending, 0),
    total_earned = GREATEST(v_total_earned, 0)
  WHERE id = p_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run for the affected vendor wallet
SELECT reconcile_vendor_wallet('dda25eae-766b-4815-9f14-b79ffbbf9bad');
```

### Frontend Change (VendorEarnings.tsx)
Compute `menuEarnings` and `riderRevenue` from the fetched `wallet_transactions` array instead of trusting `wallet.menu_earnings_balance`. This makes the UI self-correcting:

```typescript
const computedMenuBalance = transactions
  .filter(tx => tx.status === 'completed')
  .reduce((sum, tx) => {
    if (tx.category === 'vendor_share') {
      return tx.transaction_type === 'credit' ? sum + tx.amount : sum - tx.amount;
    }
    if (tx.category === 'withdrawal' && tx.metadata?.source === 'menu_earnings') {
      return sum - tx.amount;
    }
    if (tx.category === 'withdrawal_reversal' && tx.metadata?.source === 'menu_earnings') {
      return sum + tx.amount;
    }
    return sum;
  }, 0);
```

### Files to Modify
- New database migration (reconciliation function + data fix)
- `src/pages/vendor/VendorEarnings.tsx` -- compute balances from ledger for display
