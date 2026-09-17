# Roadmap

## Production checkout second hardening patch
- [ ] Atomic customer checkout, durable replay semantics, persistent rejection diagnostics
- [ ] Server-verified cart quote binding and concurrency-safe consumption
- [ ] Authoritative packaging, promotions, options and pharmacy validation
- [ ] Fail-closed rider discovery and safe older-client compatibility
- [ ] Isolated database integration tests and read-only production verification
- Damilare records and stats must not be modified; WhatsApp-specific work is pended.

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
- [x] Repair follow-up: Phase 1 rebuilt on the AI SDK agent loop (validated tool schemas, 50-step limit, structured run-id logs), free text now reaches the agent in address/confirm/location states, AI failures surface the real error instead of silently dropping to the old menu; verified with a live non-mutating model+tool call
- [x] Repair follow-up: WhatsApp checkout re-enabled — order + items + wallet debit now commit in one transaction (`whatsapp_create_order_atomic`), and idempotency is bound to a per-attempt `checkout_intent_key` on `whatsapp_carts` so repeat orders are allowed while retries de-duplicate
- [x] Repair follow-up: Phase 9 outbound delivery reliability (per-attempt logging with session/order correlation, provider status code, retry with backoff on 429/5xx/network only)
- [x] Repair follow-up: agent now runs on the configured Gemini model (`google/gemini-3.8-flash`) through the gateway chat path — no OpenAI/Astra path; live tool-calling verified
- [x] Repair follow-up: openness is schedule-authoritative (`schedule_open_now`, Lagos time) on branch discovery and the orderability gate, not the cached `is_open` flag
- [x] Repair follow-up: no outlet guessing — `get_product_details` requires an explicit branch (or the cart's own branch) and returns real branch options instead of defaulting; branch switches only clear a cart after the customer confirms (`replace_cart`)

- [x] Phase 1: tool-calling agent (agent.ts) + bounded server-authoritative tools (tools.ts), `google/gemini-3.8-flash`, structured logs

- [x] Phase 2: vendor_id + outlet_id preserved on every search result, cart line, quote, checkout and order; branches never collapsed
- [x] Phase 3: 24h session window, durable whatsapp_carts (survives context expiry), 15-min delivery quote TTL
- [x] Phase 4: shared effective-availability helper + outlet/parent-vendor closure gate on search, menu, add, checkout, reorder
- [x] Phase 5: location text geocoding, saved addresses ("usual address"), carryout/delivery switching with requote
- [x] Phase 6: quote-delivery-fee is the only fee source; no flat/Haversine fallback in the agent path
- [x] Phase 7: wallet or hosted Paystack card/bank link, whatsapp_checkouts idempotency, webhook resumes + notifies
- [x] Phase 8: order status/history/reorder/nutrition/promo/recommend tools (all revalidated server-side)
- [x] Phase 9: plain-text-first flow, per-send `twilio_api_logs` rows (session_id, order_id, attempt, provider_status_code, sid/status/error) and transient-only retry with backoff; template resubmission remains a Meta-side admin action and never blocks free text
- [ ] Live conversational acceptance tests A–N: need a real inbound WhatsApp message (Twilio signature verification blocks simulated inbound in production)

## WhatsApp delivery tracking follow-up
- [ ] Secure read-only tracking links and carryout-aware public page
- [ ] Live ownership-scoped AI delivery tools and checkout confirmation
- [ ] Authoritative event-driven, idempotent WhatsApp status notifications
- [ ] Safe automated tests and deployment verification (no live sends/orders/payments)
