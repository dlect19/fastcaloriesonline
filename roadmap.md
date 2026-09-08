# Roadmap

## Admin unattended WhatsApp alerts + vendor opt-in prompt
- [x] pg_cron job for check-unattended-orders on current project (idempotent, no service-role secret)
- [x] admin_unattended_order template in whatsapp-provision-templates; check-unattended-orders uses template, stamps only on success
- [x] Health info in UnattendedOrderAlertSettings (last run, last success, template status)
- [x] Vendor dashboard prompt (per selected outlet, dismiss w/ 7-day snooze) linking to existing WhatsApp alerts setup
- [x] Verify cron in live DB, typecheck
- [ ] BLOCKED (external): admin must click Provision Templates in Admin → WhatsApp, then Meta must approve `admin_unattended_order`
