

# Fix: Withdrawal Dialog Showing Wrong "Available" Balance

## Problem
The Vendor Earnings page correctly computes balances from the transaction ledger and shows:
- Menu Sales Revenue: **₦1,537.50**
- Rider Delivery Revenue: **₦1,983.20**

But when clicking "Withdraw", the dialog shows stale wallet column values:
- Menu Available: **₦5,745** (from `wallet.menu_earnings_balance`)
- Rider Available: **₦1,125.60** (from `wallet.rider_revenue_balance`)

The revenue cards on the withdraw page use the correct ledger-computed values, but the **withdrawal dialog** still references the raw wallet columns.

## Root Cause
In `VendorWithdraw.tsx`, lines 886-895, the withdrawal dialog displays:
```
wallet?.rider_revenue_balance || 0
wallet?.menu_earnings_balance || 0
```
instead of the already-computed `computedRiderBalance` and `computedMenuBalance`.

## Fix
Replace all references to `wallet?.menu_earnings_balance` and `wallet?.rider_revenue_balance` in the withdrawal dialog with the ledger-computed values (`computedMenuBalance` and `computedRiderBalance`). This affects three spots:

1. **Input `max` attribute** (line 886-888) -- controls maximum input value
2. **"Available" display text** (lines 891-895) -- shown below the amount input
3. **Server-side re-validation** (lines 437-439) -- the fresh wallet check before processing should also use ledger recomputation, but since this is a race-condition guard, using wallet columns as a secondary check is acceptable

### File to Modify
- `src/pages/vendor/VendorWithdraw.tsx` -- Replace `wallet?.menu_earnings_balance` and `wallet?.rider_revenue_balance` with `computedMenuBalance` and `computedRiderBalance` in the dialog section

