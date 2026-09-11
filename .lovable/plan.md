# Company Finance Audit — Expenses vs Company Balance (read-only)

No code, data, settings or balances were changed. All figures below come from live production reads.

## Headline finding

Your ₦10,000 / ₦20,000 example is real, and the cause is not the expense screen alone. Two separate places subtract money from the company balance with a "never go below zero" rule. When the company balance is smaller than the amount being subtracted, the extra amount is silently thrown away instead of leaving a deficit.

The exact event that destroyed money in production:

- 2026-09-10 16:53 — company balance recorded as **-₦33,978.20** (a real negative, correctly reached after the ₦50,000 Google Map API expense).
- 2026-09-10 17:08 — a cancelled order reversed an ₦850 commission. The reversal clamps at zero, so the balance jumped from **-₦33,978.20 straight to ₦0**.
- 2026-09-10 17:46 onward — normal commissions added on top of that ₦0, giving today's **₦1,360**.
- **₦34,828.20 of real losses vanished**, which is exactly the drift the system itself flagged on 2026-09-11 (drift log: balance ₦1,360 vs ledger -₦33,468.20, drift ₦34,828.20).

## Evidence from production

- `platform_wallet`: balance ₦1,360, total_earned ₦60,616, total_paid_out ₦76,300, test_balance ₦256.90.
- Company ledger (production, completed): credits ₦261,651.80, debits ₦295,120.00 → **net -₦33,468.20**. Includes a ₦67,706 "opening_balance" cutover row created 2026-08-08 by the reconcile routine to paper over an earlier drift, so the true historical net is worse still.
- Paid expense requisitions: 27 (26 Paystack ₦240,800 + 1 manual ₦4,000) = **₦244,800**. Company ledger expense debits: 27 rows = **₦244,800**. No missing or duplicate expense rows.
- Only the last 3 expense rows carry a reference and a running balance (`balance_after` -₦1,443, ₦377.80, -₦36,928.20). The older 24 have no reference and no running balance — they were inserted directly, with no duplicate protection.
- Balance-change guard log confirms the clamp: old value -₦33,978.20 … then old value ₦0 on the next entry.
- Drift log history: ₦67,706 drift (2026-08-08, papered over), ₦34,828.20 drift (2026-09-11, current).

## 1) Expense requisition lifecycle

- Submit: `ExpenseRequisitionForm` → row in `expense_requisitions` (status `pending`).
- Approve/reject: `ExpenseRequisitionList` updates status/approver fields only. No money moves.
- Pay via Paystack: `ExpenseRequisitionList.handlePayViaPaystack` → edge function `process-expense` → creates Paystack recipient + transfer → sets requisition to `paid` → calls the ledger routine `post_platform_entry` (category `expense`, debit, reference `EXP-<id>`). This path **does** allow a negative balance and records a running balance.
- Pay manually: `ExpenseRequisitionList.handleMarkAsPaid` → sets `paid` → inserts a ledger row by hand (no reference) → then reads the balance and writes back `Math.max(balance − amount, 0)`. **This is clamp #1.**

## 2) Where the balance is clamped

- `ExpenseRequisitionList.tsx` line 232: `Math.max(currentBalance - amount, 0)` (manual expense payment).
- Database routine `reverse_financials_on_cancellation`: `GREATEST(balance − amount, 0)` and `GREATEST(total_earned − amount, 0)` for commission / service fee / delivery commission reversals on cancelled orders. **This is clamp #2 and it caused the ₦34,828.20 loss.**
- The same clamp style is used across vendor/rider/customer wallet reversals in that routine (appropriate there, wrong for the company).

## 3) Who writes the company balance

Correct path (no clamp, keeps a running balance, refuses duplicates by reference): `post_platform_entry`.
Direct writes that bypass it:
- `credit_vendor_on_payment` (commission + service fee on every paid order) — direct add, ledger row inserted separately.
- `credit_rider_on_assignment` (delivery commission) — same pattern.
- `reverse_financials_on_cancellation` — clamped subtraction.
- `adjust_vendor_payout_after_refund` — direct add/subtract, and it **edits an existing ledger row's amount in place** rather than posting a correcting entry.
- `ExpenseRequisitionList` (manual pay), `AdminFinancialTools` (refund reversal), edge function `backfill-ledger`.
- `reconcile_platform_wallet` does not correct the balance; when it sees drift it writes an `opening_balance` row to make the ledger match the balance — i.e. it hides the loss instead of surfacing it. That is where the ₦67,706 row came from.

## 4–5) Is the ledger the source of truth?

Intent: yes, `wallet_transactions` is designed as the ledger, and the drift detector compares balance against it. Reality: `platform_wallet.balance` is an independently mutated number that currently **does not** reconcile — ₦1,360 stored vs -₦33,468.20 in the ledger. Drift arises from the two clamps, from in-place ledger amount edits, and from the cutover rows that mask rather than resolve differences.

## 6) Expense entries

Counts and sums match exactly (27 / ₦244,800). Weaknesses: 24 of 27 rows have no reference (a repeated click could double-post), 24 have no running balance, and the manual-payment path posts the ledger row and the balance change as two separate steps, so a failure between them leaves them inconsistent.

## 7) What the numbers actually mean

- `balance`: a mutable bucket, not verified cash and not retained earnings. It floors at zero on some paths, so it understates losses.
- `total_earned` / `total_paid_out`: only maintained by `post_platform_entry`, and `total_earned` is also reduced by cancellations — so it is neither lifetime income nor a reliable cumulative figure. ₦60,616 earned vs ₦76,300 paid out cannot be squared with a ₦1,360 balance.
- "Withdrawable balance" in the admin card = `balance − pending payouts`. It mixes company profit with money owed to vendors/riders and is not a cash position; actual bank cash lives in Paystack.

## 8) Admin UI review

`CompanyProfitCard` (Expenses page, admin dashboard) computes income and expenses purely from the ledger and **does** show a negative net profit correctly, including a "Loss" badge. But: withdrawable balance is read from the clamped stored balance, so it shows ₦1,360 while the true position is about -₦33,468. It omits dispute deductions (₦31,460.20) and commission reversals from the expense side, has no transaction history list, and formats negatives inconsistently.

## 9) Other inflows/outflows

Inflows: order commission, service fee, delivery commission, POS wallet fee, food commission. Outflows: expenses, promo cost, referral cost, dispute deductions/corrections, commission and service-fee reversals on cancellation. Clamped or divergent points: cancellation reversals (clamped), manual expense payment (clamped), refund adjustment (edits ledger history), reconcile cutover rows (masks drift), and every direct balance write listed in section 3.

## 10) Recommended design (not implemented)

1. Make `post_platform_entry` the only way the company balance ever changes; convert all direct writes to it, including reversals, and let the balance go negative.
2. Remove both zero-clamps for the company account; keep clamps only where a user wallet genuinely must not go negative.
3. Never edit a posted ledger amount — post a correcting entry with its own reference instead.
4. Separate two figures in the model and in the UI: accounting position (retained profit/deficit from the ledger, may be negative) and cash liquidity (Paystack balance minus money owed). Requisitions above available cash should be flagged as overdrawn, not silently absorbed.
5. Change the reconcile routine to report drift and require an explicit, audited correction entry instead of writing `opening_balance` rows.
6. Require a reference on every company ledger entry so retries cannot double-post.
7. Extend the profit card: all expense categories, transaction history, explicit deficit display, cash vs profit split.

## 11) Migration/backfill approach (not executed)

1. Freeze the interpretation: treat the ledger as truth and today's balance as unverified.
2. Quantify each historical distortion separately — the ₦67,706 cutover row, the ₦34,828.20 clamp loss, and any in-place amount edits — and record them in an audit table.
3. Decide with you whether the pre-August history gets a single dated, documented opening-equity entry (an accounting decision, not a technical one), then post it once with a fixed reference.
4. Re-point the balance to the ledger total in one audited correction entry, after the clamps are removed, so it cannot re-drift.
5. Verify by re-running drift detection and confirming zero drift, then keep drift detection as an alert rather than a self-healing job.

No changes will be made until you approve a direction.
