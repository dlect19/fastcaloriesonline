# Rider Withdrawal Options (Instant / Daily / Weekly / Monthly)

Riders pick how they get paid. Instant and Daily riders pay the transfer charge; Weekly and Monthly are absorbed by FastCalories. Every figure (charges, minimum, schedule times/days, preference-change rule) lives in admin-editable settings with clearly labelled placeholder defaults — no hardcoded money.

## What exists today (verified)

- `payout_requests` already holds amount, status, Paystack transfer code/reference, bank fields, failure reason, retry count, environment.
- `deduct_wallet_on_payout_request` trigger already moves the requested amount out of the withdrawable balance into `wallets.pending_payouts`, and restores it on failure / clears it on completion.
- `process-payout` edge function performs the Paystack transfer; `check-processing-payouts` and `verify-transfer-status` reconcile provider status.
- `platform_settings` (key/value) already stores `min_withdrawal_amount` (currently 1000) and `payout_approval_mode`, and Admin Settings renders these; `ServiceFeeSettings` is the pattern for grouped, category-specific config.
- Rider withdrawal UI is `src/pages/rider/RiderWithdraw.tsx` (manual request + OTP + legacy `auto_withdraw` toggle on the wallet row).

So this is an extension of the existing payout pipeline, not a new one. The legacy `auto_withdraw` / `auto_withdraw_threshold` / `auto_withdraw_day` wallet fields get superseded by the new preference record (existing values migrated across).

## 1. Settings (new dedicated table)

New table `rider_payout_settings` — one row per key, admin-only writes, readable by authenticated riders (they must see minimum + their charge). Seeded placeholder defaults, each described as "placeholder — confirm with business":

| Key | Placeholder |
| --- | --- |
| `charge_instant` | 100 |
| `charge_daily` | 50 |
| `charge_weekly` | 0 (absorbed by FastCalories) |
| `charge_monthly` | 0 (absorbed by FastCalories) |
| `min_withdrawal` | 1000 |
| `daily_run_time` | 23:00 (Africa/Lagos) |
| `weekly_settlement_day` | Friday |
| `monthly_settlement_date` | last day of month |
| `preference_change_rule` | anytime (effective next cycle) |
| `instant_eta_text` | "Within 15 minutes – 24 hours" |

## 2. Rider preference

New table `rider_payout_preferences`: rider id, option (`instant`/`daily`/`weekly`/`monthly`), preferred bank account reference, effective-from timestamp, last-changed timestamp, next scheduled run.

Changing the option writes `effective_from` = start of the next cycle, so schedulers never fire twice for one cycle. If the admin rule is "once per cycle", a change is rejected until the current cycle closes.

New rider UI section (inside the existing Withdraw/Settings screen): the four options as cards with charge-bearer labelled, preferred bank picker, read-only minimum + applicable charge, next scheduled payout date, and a note that changes apply from the next cycle.

## 3. Instant withdrawal confirmation screen

Rewire the manual request dialog to a two-step confirm before submission showing: current withdrawable balance, requested amount, transfer charge, net amount received, masked destination account, estimated processing time, then Confirm. Existing OTP step is kept after confirmation.

## 4. Ledger

New table `rider_withdrawal_ledger`, append-only (insert-only policy; no update/delete for riders, admin corrections go through a new row + audit log). Columns: withdrawal reference (unique), rider id, wallet id, payout option, gross amount, transfer charge, charge-bearer (`rider` | `fastcalories`), net transferred, balance before, balance after, bank account snapshot, provider reference, status (`requested`/`processing`/`completed`/`failed`/`reversed`/`cancelled`), timestamps, failure/reversal reason, idempotency key.

`payout_requests` gains `payout_option`, `transfer_charge`, `charge_bearer`, `net_amount`, `withdrawal_reference`, `idempotency_key` (unique) so the ledger row and the transfer stay linked. Status transitions on `payout_requests` mirror into the ledger via trigger, so the balance-before/after values are captured by the same statement that moves the money — no direct balance writes anywhere.

Transfer charges post to a dedicated `transfer_charges` bucket in the platform ledger, tagged as cost recovery, deliberately excluded from revenue in the reconciliation/company-profit views.

## 5. Scheduled payouts

One new edge function `rider-scheduled-payouts` (mode: `daily` | `weekly` | `monthly`), driven by pg_cron in Africa/Lagos time from the configured schedule values. For each eligible rider with that preference and `effective_from` in the past:

- take only cleared/withdrawable balance (excludes `pending_payouts`, pending releases, disputed/on-hold amounts);
- skip and carry forward if below `min_withdrawal`;
- compute charge and bearer from settings — deduct from the rider for daily, absorb for weekly/monthly;
- insert `payout_requests` + ledger row under a deterministic idempotency key (`rider:option:cycle`), so a re-run or retry can never duplicate a transfer;
- hand off to the existing transfer path; provider confirmation, failure reversal and reason capture reuse `check-processing-payouts` / `verify-transfer-status`.

Notifications on Requested / Completed / Failed / Reversed via the existing in-app + push/email notification path.

## 6. Admin

New "Rider Withdrawals" settings section (same layout language as the pharmacy/grocery service-fee tabs) for all values above, with the rationale copy: riders on instant/daily absorb the charge because frequent withdrawals repeat the cost; FastCalories absorbs weekly/monthly because they reduce transfer volume.

Admin payouts page gains filters for rider, frequency, status, date range, and provider reference, plus the per-withdrawal ledger detail (charge, bearer, net, balances before/after). Manual balance adjustments continue to write both a ledger entry and an admin audit-log entry.

## Notes

- All money maths runs server-side; the rider UI only displays values returned by the backend.
- Cutover: migrate existing `auto_withdraw` riders to the `weekly`/`monthly` preference matching their current setting, everyone else to `instant`, so no rider loses access.
- Placeholder amounts are flagged in the admin UI so they are obviously provisional until business confirms.
