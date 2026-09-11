# Roadmap

## Admin unattended WhatsApp alerts + vendor opt-in prompt
- [x] pg_cron job for check-unattended-orders on current project (idempotent, no service-role secret)
- [x] admin_unattended_order template in whatsapp-provision-templates; check-unattended-orders uses template, stamps only on success
- [x] Health info in UnattendedOrderAlertSettings (last run, last success, template status)
- [x] Vendor dashboard prompt (per selected outlet, dismiss w/ 7-day snooze) linking to existing WhatsApp alerts setup
- [x] Verify cron in live DB, typecheck
- [ ] BLOCKED (external): admin must click Provision Templates in Admin → WhatsApp, then Meta must approve `admin_unattended_order`

## Company accounting fix (deficit-capable platform ledger)
- [ ] Remove zero clamps (manual expense client path, reverse_financials_on_cancellation platform branch)
- [ ] post_platform_entry = only company money path; unique platform reference index
- [ ] Convert direct writers (commission, delivery commission, reversal, refund adjustment, expenses)
- [ ] Immutable ledger: refund adjustments post correcting entries, no in-place amount edits
- [ ] reconcile_platform_wallet reports drift only (no opening_balance manufacturing)
- [ ] Atomic expense payment RPC used by manual + Paystack paths
- [ ] Admin UI: accounting position vs wallet cash, deficit, income/expense breakdown, ledger history, reconciliation review
- [ ] Verify with production reads; leave historical ₦34,828.20 drift correction for explicit admin action
