# Vendor withdrawable-balance drift: findings and amendment plan (read-only so far)

## Result table (production, 2026-10-02)

| Wallet | Displayed / withdrawable (balance = eligible) | Ledger-supported (completed prod net) | Overstated | menu_earnings_balance (stored) |
|---|---|---|---|---|
| TOP KITCHEN 1bb29c33… | ₦6,920 | ₦0 | ₦6,920 | -₦1,240 |
| Taste Affairs Main 575d115f… | ₦12,380 | ₦3,630 | ₦8,750 | -₦20,455 |
| All other 24 vendor wallets | match | match | ₦0 | — |
| Total | | | ₦15,670 | |

Drift was checked per wallet id, so wallets that share a user id were not counted twice.

## Root cause (confirmed)

`reconcile_vendor_wallet()` rebuilds `balance`, `eligible_balance` and `menu_earnings_balance` from only some of the ledger categories:
- It counts `vendor_share`/`voucher_sale` credits, "Menu Earnings" withdrawals and their reversals, and `admin_credit`/`admin_debit`.
- It ignores three kinds of debit: `dispute_deduction`, `adjustment`, and `vendor_share` debits (refunds and clawbacks).
- It floors the result at 0.

Running that formula on today's rows gives exactly ₦6,920 for TOP KITCHEN and ₦12,380 for Taste Affairs, the same as the stored balances. So the drift equals the ignored debits:
- **TOP KITCHEN:** adjustment ₦400 + dispute deductions ₦2,100 + vendor_share debits ₦4,420 = **₦6,920**
- **Taste Affairs:** dispute deductions ₦2,700 + vendor_share debits ₦6,050 = **₦8,750**

## Where the formula runs and changes money

Only one path lets it change money fields: when a payout is requested, `deduct_wallet_on_payout_request` runs it first, inside the trigger. Trigger depth is greater than 1 there, so `prevent_balance_manipulation` does not block it. The payout check then uses the inflated `menu_earnings_balance`.

The timestamps show the drift steps landing on payout days:
- **TOP KITCHEN:** drift was ₦6,420 from Aug 15 to Aug 31, then ₦6,920 from Sep 1. A ₦500 dispute deduction (Aug 29) was wiped out by the reconcile inside payout c5379faf (₦12,560, Aug 31, 15:21).
- **Taste Affairs:** drift was ₦7,350 until Sep 23, then ₦8,750 from Sep 24. Wallet minus ledger rose ₦1,400 around payout 6b7342dc (₦32,835, Sep 23, 16:26), which matches the second dispute deduction (Aug 23).
- **Aug 7 repair:** it rebuilt both wallets correctly. Each later payout's reconcile then removed the deductions again. Taste Affairs went straight back to ₦7,350.

## The 17:45:15 UTC update

All 26 vendor wallets were updated within about 130 ms (17:45:15.248 to 17:45:15.381). No migration and no ledger row was written at that time, and no edge function request was logged.

The source code points to the admin Payouts page. `AdminPayouts.fetchManualVendorWallets` calls `reconcile_vendor_wallet` for every vendor wallet in parallel, under the admin's signed-in session. For those calls, `prevent_balance_manipulation` puts every money field back to its old value. Only `updated_at` changed.

This also explains why the stored menu bucket stays negative: the vendor's Withdraw screen reconcile is reverted the same way. This attribution is inferred from the code and timing; there is no request log to prove it.

## Answers to the questions

1. **What the vendor sees as withdrawable:** the Withdraw screen shows `menu_earnings_balance` (plus rider revenue, if any). The dashboard shows `balance`/`eligible_balance`. The payout gate checks `menu_earnings_balance` after the reconcile runs inside the trigger, so it really allows the formula value: ₦6,920 and ₦12,380.
2. **What transaction history counts:** completed production rows only, all categories. Cancelled `vendor_share` rows (TOP KITCHEN 11 rows, ₦24,785; Taste Affairs 3 rows, ₦11,550) are correctly left out of both totals. There are no pending rows, and pending_balance is 0.
3. **Where the ₦6,920 and ₦8,750 come from:** the ignored debits listed above. It is not a missing opening balance, not a payout reversal, and not caused by the repair script.
4. **Negative menu_earnings_balance:** this is a stale bucket. The deduction trigger subtracts each payout from it, and the reconcile that would reset it is reverted on the signed-in paths. It is reporting only: the payout gate resets it to the inflated formula value before checking.
5. **Payout cross-check:** each Aug–Oct payout has exactly one matching `PAYOUT-REQ-<id>` ledger debit with no transfer charge, except one. TOP KITCHEN payout 62423211 (₦8,300, Aug 1, completed) has no ledger row. It predates the Aug 7 rebuild, so the rebuild already absorbed it. It needs a separate review, but it is not part of today's drift. I found no duplicate `VENDOR-SHARE-<order>` references.
6. **Other wallets:** no other vendor wallet has drift, checked one row per wallet id.
7. **Current risk: yes.** On their next withdrawal, TOP KITCHEN can take ₦6,920 above what the ledger supports and Taste Affairs ₦8,750, ₦15,670 in total. The payout gate would approve it.

## Amendment plan (needs your approval, nothing applied)

1. **Close the overdraw now (safest first):** add a migration that changes `reconcile_vendor_wallet` to use the full completed ledger net:
   - `balance` = sum of all completed credits minus debits for the environment
   - `menu_earnings_balance` = min(menu formula including dispute, adjustment and vendor_share debits, balance)
   - Keep the 0 floor only on the withdrawable buckets, never on `balance`. Keep the hold-period logic.
2. **Add a payout guard:** in `deduct_wallet_on_payout_request`, also refuse any payout greater than the completed ledger net.
3. **Correct the two wallets:** after step 1, run the existing step-up-protected, audited drift correction once per wallet. It needs expected drift ₦6,920 and ₦8,750. It sets the stored balance to the ledger value with no invented ledger entries. Then confirm the drift job reports 0.
4. **Stop the useless mass reconcile:** remove the per-wallet reconcile loop from the admin Payouts page and read the values instead. This is a separate frontend change.
5. **Review payout 62423211 (₦8,300, Aug 1):** it has no ledger row. Decide whether to add a back-dated audit note, with no balance effect.
6. **Add regression tests:** dispute, adjustment or vendor_share debit followed by a payout request must leave balance equal to the ledger, and the payout cap must never exceed the ledger.
