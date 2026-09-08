# Roadmap

## Admin unattended WhatsApp alerts + vendor opt-in prompt
- [ ] pg_cron job for check-unattended-orders on current project (idempotent, no service-role secret)
- [ ] admin_unattended_order template in whatsapp-provision-templates; check-unattended-orders uses template, stamps only on success
- [ ] Health info in UnattendedOrderAlertSettings (last run, last success, template status)
- [ ] Vendor dashboard prompt (per selected outlet, dismiss w/ 7-day snooze) linking to existing WhatsApp alerts setup
- [ ] Verify cron in live DB, typecheck, report Meta approval step
