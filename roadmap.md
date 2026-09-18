# Roadmap

## Production checkout second hardening patch
- [x] Reject unsafe numeric add-on pricing inputs; isolated PostgreSQL pricing regression tests (17)
- [x] Server same-key replay and post-savepoint diagnostics; new-key similarity warning only
- [x] Atomic wallet RPC deployed and current wallet checkout wired; local persisted attempt identifiers
- [x] Admin-controlled canary rollout gate for server checkout (disabled, 0% exposure) with audited settings, decision logging and 23 database tests
- [ ] Full production-equivalent accounting integration coverage and cross-tab intent locking
- [ ] Multi-session PostgreSQL concurrency and full POS/assisted regression coverage
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

## WhatsApp production safety phase (resumed 17 Sep 2026)
- [x] D — legacy `confirmWhatsAppOrder` paid-order path removed; fail-closed tombstone logs LEGACY_PATH_BLOCKED and writes nothing (both call sites labelled)
- [x] B — inbound images/PDFs treated as unverified hints: recorded, never marked paid, never fed to the agent (prescription flow untouched)
- [x] C (verified, no change needed) — Paystack webhook already enforces HMAC, NGN, exact amount, customer binding, environment, dead-order late payment, duplicate guard
- [x] E — no outlet guessing: checkout requires an explicit branch; reorder now asks the customer to choose from real eligible branches (default-outlet fallback removed)
- [x] F (verified) — only `whatsapp_create_order_atomic` creates WhatsApp orders; webhook writes no order/item/wallet row; checkout intent key + idempotency key already durable (tests assert this)
- [x] A — voice gating live (migration 0028): master switch, size/duration caps, per-phone minute/hour/day limits, global daily ceiling + concurrency, Twilio-host-only media with no blind redirects, one reservation per MessageSid, redacted usage audit with 30-day retention
- [x] Legacy numbered-menu list now renders availability for the branch the customer explicitly picked (outletBinding.ts, `choosing_outlet` state); no default/main/first branch is ever substituted
- [x] 69. Secure rider offer discovery RPC (get_my_rider_offers), unified client discovery, destination coordinate precedence, durable dispatch expiry/retry sweep (cron every minute), one authoritative rider capacity status set.
- [x] Voice-note media fetch hardened (mediaFetch.ts): one validated redirect hop to Twilio-owned media hosts / signed Twilio S3 store only, no credential forwarding, SSRF blocks, streaming byte cap, body sanity check, redacted host-only refusal logs — fixes the REDIRECT_REJECTED failures of 18 Sep 2026

- [x] Voice-note redirect allowlist extended to Twilio MMS media CDN (mms.twiliocdn.com + regional mms.<region>.twiliocdn.com) as a redirect target only — fixes REDIRECT_HOST_NOT_ALLOWED failures of 18 Sep 2026 01:01/01:02

- [x] 70. WhatsApp payment-method screen: server-read wallet balance + shortfall shown, wallet option only when the balance covers the authoritative total, single server-generated Paystack link (paymentChoice.ts, runWhatsAppPayment in index.ts); legacy confirm path now has zero call sites; strict Paystack verification (reference/currency/amount/customer/status) extracted to _shared/paystackVerification.ts and enforced in verify-whatsapp-funding.
- [x] 71. Paystack webhook order-confirmation fix: removed nonexistent orders.currency from the lookup (42703 was misreported as "Order not found", blocking genuine payment FC-260918-4895); DB lookup errors now classified separately from missing orders; all signature/NGN/amount/customer/environment/idempotency protections preserved. Regression tests: src/test/paystack-webhook-order-lookup.test.ts (8 tests). Deployed paystack-webhook only.

## WhatsApp order-status costing + rider contact (done)
- Upfront status-message allowance frozen into the WhatsApp communications part of the service fee (shadow by default, ₦0 to customers).
- Delivery vs carryout expected counts; carryout excludes rider states; admin-configurable settings + margin reporting.
- Assigned rider name/verified phone included in the WhatsApp assignment update; support fallback when unverified.
