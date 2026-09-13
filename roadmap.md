# Roadmap

## Admin unattended WhatsApp alerts + vendor opt-in prompt
- [x] pg_cron job for check-unattended-orders on current project (idempotent, no service-role secret)
- [x] admin_unattended_order template in whatsapp-provision-templates; check-unattended-orders uses template, stamps only on success
- [x] Health info in UnattendedOrderAlertSettings (last run, last success, template status)
- [x] Vendor dashboard prompt (per selected outlet, dismiss w/ 7-day snooze) linking to existing WhatsApp alerts setup
- [x] Verify cron in live DB, typecheck
- [ ] BLOCKED (external): admin must click Provision Templates in Admin → WhatsApp, then Meta must approve `admin_unattended_order`

## Company accounting fix (deficit-capable platform ledger)
- [x] Remove zero clamps (manual expense client path, reverse_financials_on_cancellation platform branch)
- [x] post_platform_entry = only company money path; unique platform reference index; service-role only
- [x] Convert direct writers (commission, delivery commission, reversal, promo reversal, refund adjustment, expenses, admin refund reversal)
- [x] Immutable ledger: refund adjustments post correcting entries, no in-place amount edits
- [x] reconcile_platform_wallet reports drift only (no opening_balance manufacturing)
- [x] Atomic idempotent finalize_expense_payment used by manual + Paystack paths
- [x] Admin UI: accounting position vs wallet cash, deficit, categorized costs, ledger history, reconciliation review
- [x] Verified with production reads; historical ₦34,828.20 drift left visible, correction needs admin step-up
- [ ] Optional: backfill-ledger edge function still writes platform balance directly (historical one-off tool, unused in normal flow)

## WhatsApp AI commerce agent rebuild
- [x] Phase 1: tool-calling agent (agent.ts) + bounded server-authoritative tools (tools.ts), gemini-2.5-flash w/ Gemini fallback, structured logs
- [x] Phase 2: vendor_id + outlet_id preserved on every search result, cart line, quote, checkout and order; branches never collapsed
- [x] Phase 3: 24h session window, durable whatsapp_carts (survives context expiry), 15-min delivery quote TTL
- [x] Phase 4: shared effective-availability helper + outlet/parent-vendor closure gate on search, menu, add, checkout, reorder
- [x] Phase 5: location text geocoding, saved addresses ("usual address"), carryout/delivery switching with requote
- [x] Phase 6: quote-delivery-fee is the only fee source; no flat/Haversine fallback in the agent path
- [x] Phase 7: wallet or hosted Paystack card/bank link, whatsapp_checkouts idempotency, webhook resumes + notifies
- [x] Phase 8: order status/history/reorder/nutrition/promo/recommend tools (all revalidated server-side)
- [ ] Phase 9: template repair/resubmission + twilio_api_logs correlation & retry/backoff for outbound sends (free-text flow already works without templates)
- [ ] Live conversational acceptance tests A–N: need a real inbound WhatsApp message (Twilio signature verification blocks simulated inbound in production)
