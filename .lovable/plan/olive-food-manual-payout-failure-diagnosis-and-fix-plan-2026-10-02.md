# Olive Food manual payout failure: diagnosis and fix plan

## What happened
The admin tried to pay out ₦12,380 three times (about 19:48–19:49 UTC). Each attempt was rejected by the database. Nothing was saved: no payout record, no ledger debit, no Paystack transfer. The wallet is unchanged: balance ₦12,380, menu earnings ₦12,380, pending payouts ₦0, not frozen.

## Evidence
- The process-payout logs show the same error three times, for payouts b4f669cf…, eca79487… and 0033dd88…: `P0001 PAYOUT_LEDGER_MISMATCH: payout … has 0 matching ledger debits (expected 1)`, followed by "Error creating admin vendor payout request". The app then returns error 500, which the screen shows as "non-2xx".
- The database has no payout_requests rows with those IDs and no `PAYOUT-REQ-…` ledger rows. The whole attempt was rolled back.
- The code never reached Paystack. The transfer call only runs after the payout record is saved, and saving failed.
- The freeze and drift checks passed. If either had blocked the payout, the error would have said PAYOUT_FROZEN or PAYOUT_FROZEN_LEDGER_DRIFT. The amount check also passed.
- No production payout has succeeded since migration 0038 went live; the last one was on 2026-09-25. Every payout would fail the same way, for both vendors and riders.

## Root cause: a bug in the new matching-debit check
1. In `payout_requests`, the `environment` column defaults to `'development'`, and process-payout doesn't set it.
2. `deduct_wallet_on_payout_request` runs after the row is inserted. It sets `NEW.environment := 'production'` and writes the ledger debit with `environment='production'`. But changing NEW in an after-insert trigger doesn't change the saved row, so the payout row keeps `'development'`.
3. At commit, the deferred check `assert_payout_has_ledger_debit` reads the saved row's `environment` (`'development'`). It then looks for a debit with `environment='development'`, finds 0, and rolls everything back.

The problem isn't timing or ordering, and it isn't a real accounting mismatch. The two functions disagree about the environment. The real debit exists inside the attempt, but it's labelled production while the payout row says development.

## Minimal safe fix (needs your approval)
One additive migration, with no data changes:
1. Add a before-insert trigger on `payout_requests` that sets `NEW.environment` from `get_platform_environment()`. This makes the saved row match the debit.
2. Change `assert_payout_has_ledger_debit` to match on wallet, reference, category, type, status and amount, and to use the debit's environment rather than the row's. The rule of exactly one completed debit stays unchanged.
3. Keep all other safeguards as they are: freeze, drift and amount limits, and the deferred one-debit rule.
4. Add tests that a production payout insert creates one debit and commits, and that a missing debit still fails.

No retry, transfer or wallet change will happen during the fix. After it's deployed, the admin can try the ₦12,380 payout once.

## Technical details
- Files and functions: `drizzle/migrations/0038_vendor_wallet_ledger_guards.sql` (`deduct_wallet_on_payout_request` lines 136–137, `assert_payout_has_ledger_debit` lines 261–286), and `supabase/functions/process-payout/index.ts` (admin vendor insert lines 221–245, self-service insert lines 313–336).
- Optional: process-payout could also set `environment` explicitly. The database trigger alone is enough.
