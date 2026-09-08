# Audit: Admin "Unattended Order WhatsApp Alerts" + vendor WhatsApp opt-in

Audit only. No code was changed. Every claim below was verified against the live database or the actual source.

## 1. What implements the admin unattended alert

| Layer | Location |
|---|---|
| Admin UI card | `src/components/admin/UnattendedOrderAlertSettings.tsx`, mounted in `src/pages/admin/AdminSettings.tsx` (~line 651) |
| Settings storage | `public.platform_settings` keys `admin_unattended_alert_enabled`, `admin_unattended_alert_phone`, `admin_unattended_alert_minutes` (upserted by `handleSave` in AdminSettings) |
| Once-only flag | `orders.admin_unattended_alerted_at` (added in migration `20260711194608_…`) |
| Detector + sender | Edge function `supabase/functions/check-unattended-orders/index.ts` — selects `orders` with `status in (pending, confirmed)`, `payment_status = paid`, `admin_unattended_alerted_at IS NULL`, `created_at <= now - N min`; sends free-form WhatsApp via `sendTwilioMessage` (`_shared/twilioMessaging.ts`, Lovable Twilio connector gateway); stamps the flag; logs to `twilio_api_logs` |
| Scheduler | Meant to be a `pg_cron` job named `check-unattended-orders` running every minute (migrations `20260716091204`, `20260717134358`, `20260717134427`, `20260717134515`) |

Live settings are correct: enabled = `true`, phone = `08127917744` (normalizes cleanly to `+2348127917744`), minutes = `3`. Sender number `whatsapp:+2348103128494` is set. Secrets `LOVABLE_API_KEY` / `TWILIO_API_KEY` are evidently present because the sibling `vendor-order-alerts` function sends successfully through the same helper.

## 2. Root cause: the job is not scheduled in this backend

**Primary (confirmed):** `cron.job` in the live database contains no `check-unattended-orders` entry. The 9 active jobs are: release-pending-vendor-earnings, auto-store-status-check, check-processing-payouts, wallet-drift-detector, release-event-organizer-holds, vendor-wa-new-order, vendor-wa-unattended, vendor-wa-daily-summary, rider-scheduled-payouts. The function has therefore never been invoked:

- `twilio_api_logs` has 0 rows for `function_name = 'check-unattended-orders'` (vs. dozens of successful `vendor-order-alerts` rows).
- Of 16 paid orders in the last 14 days, 0 have `admin_unattended_alerted_at` set — including ones that later triggered the *vendor* "still waiting after 4 minutes" alert (e.g. `FC-260907-7740`), proving they were unattended past the 3-minute admin threshold.
- Edge function logs for this function show no boots in the recent window.

Why it is missing: all four scheduling migrations hard-code the URL `https://bruyccrjymmpzulqhotw.supabase.co/functions/v1/check-unattended-orders` plus an anon JWT for that same ref. That is a **different backend project** from the current one (`yrfbvuiinvytlvouzyxv`). Either the job was never created in this project, or it was created pointing at the wrong host and later removed; in both cases nothing in this backend calls the function. The vendor `vendor-wa-*` jobs were created separately against the correct host, which is why they work.

**Secondary (will bite once scheduled):** the function sends a **free-form** message (no `contentSid`). Meta only allows free-form messages inside a 24-hour window after the recipient last messaged the business. The admin number's last inbound message to the business number was 2026-08-21, so today a free-form send would be rejected with Twilio error 63016 (the same class of failure documented in the earlier "Could not send code" plan). The `vendor_unattended_order` template (`HX7a3d…`) exists in `whatsapp_templates` but its `approval_status` is still `pending`; there is no admin-specific template. Until a template is approved, the admin alert would only deliver if the admin has messaged `+234 810 312 8494` in the last 24 hours.

**Not the cause (checked):** number normalization, query filters, the alerted-once flag, RLS (function uses service role), `verify_jwt` (the other cron jobs use the same header pattern successfully), sender config.

## 3. Existing vendor WhatsApp new-order logic — yes, it exists and is working

- Table `public.vendor_whatsapp_alerts` (one row per outlet): `vendor_id`, `outlet_id` (unique), `phone`, `phone_verified`, `enabled`, `alert_new_order`, `alert_unattended`, `alert_daily_summary`, `last_alert_at`. Currently 4 rows, all enabled and verified.
- Sender: `supabase/functions/vendor-order-alerts/index.ts` with modes `new_order` / `unattended` / `daily_summary`, driven by the three live `pg_cron` jobs `vendor-wa-new-order` (every minute), `vendor-wa-unattended` (every minute), `vendor-wa-daily-summary` (21:00 UTC). It uses template content SIDs from `whatsapp_templates` (`vendor_new_order`, `vendor_unattended_order`, `vendor_daily_summary`) and stamps `orders.vendor_wa_new_order_alerted_at` / `vendor_wa_unattended_alerted_at`. Logs show `sent` for new-order, unattended and daily-summary messages on 2026-09-07.
- Opt-in flow: `src/components/vendor/VendorWhatsAppAlerts.tsx` inside Vendor Settings (`src/pages/vendor/VendorSettings.tsx` ~line 427). Vendor enters a number per outlet (pre-filled from `vendors.phone`), `vendor-alert-phone` edge function sends a 6-digit OTP (`send_code`), `verify_code` upserts the row with `phone_verified = true, enabled = true`; `test_alert` sends a sample.

So the cleanest place for the new prompt is a thin banner that deep-links into this existing, working flow — not a new notification pipeline.

## 4. Vendor-facing opt-in prompt: assessment

Intended behaviour: show "Get new order alerts on WhatsApp" with an Enable button on the vendor dashboard only for vendors not yet set up; hide once configured.

Recommended eligibility rule (data already available):
- Show when the vendor has **no** row in `vendor_whatsapp_alerts` with `enabled = true AND phone_verified = true` for the currently selected outlet (or for any outlet, for single-branch vendors).
- Hide when such a row exists. Also allow a "Not now" dismissal persisted per vendor (e.g. localStorage key or a small `vendor_whatsapp_alerts.prompt_dismissed_at`-style column) so it is not nagging.

Phone field reuse vs dedicated setting:
- `vendors.phone` is the business contact number and is already used as the pre-filled default in the alerts card. It is fine as a **default suggestion**, but must not be treated as opted-in: it is unverified, may be a landline/customer-service line, and is per-vendor while alerts are per-outlet.
- `profiles.phone` is the owner's personal login/verification number — wrong entity for business alerts.
- The dedicated `vendor_whatsapp_alerts` row (verified via OTP) is the safe source of truth and already exists. No new setting table is needed; the OTP verification step should stay, because Meta will not deliver to a number that has not been confirmed and an unverified number would silently waste template sends.

UX shape: a dismissible card on `src/pages/vendor/VendorDashboard.tsx`, following the existing `PushNotificationBanner` pattern, whose Enable button either opens the existing alerts card inline (number pre-filled from `vendors.phone`, one tap to send code) or navigates to Vendor Settings scrolled to the WhatsApp Alerts section.

## 5. Recommended architecture for reliable alerts

Keep everything server-side; no dashboard needs to be open and no page polling.

1. **Fix the admin job:** create a `pg_cron` job in *this* backend that calls `check-unattended-orders` on the current project URL with the current anon key, every minute — same pattern as the working `vendor-wa-*` jobs. Alternatively fold the admin check into the existing `vendor-order-alerts` `unattended` mode so one minute-job serves both vendor and admin (fewer boots, one code path). Every-minute cadence is already the accepted norm for the vendor jobs; a 1-minute job runs 1,440 times/day.
2. **Use a template, not free-form:** send the admin alert with an approved utility template (either reuse `vendor_unattended_order` once Meta approves it, or add an `admin_unattended_order` template to `whatsapp-provision-templates`). Surface `approval_status` in Admin → WhatsApp so a pending template is visible. Until approved, log the 63016 failure clearly instead of failing silently.
3. **Vendor new-order alerts:** the current cron + `vendor_wa_new_order_alerted_at` idempotency is sound. An optional refinement is a database webhook on `orders` (payment_status → paid) that pings `vendor-order-alerts` immediately for near-instant delivery, keeping the minute cron as a reconciliation backstop.
4. **Observability:** the Twilio cost/log table already captures every attempt; add a small admin indicator for "last successful admin alert" and "job last run" so a missing job is noticed immediately rather than months later.

## Technical details (for implementation later, not part of this audit)

- New cron: `cron.schedule('check-unattended-orders', '* * * * *', net.http_post(url := '<current-project>/functions/v1/check-unattended-orders', headers := {"Content-Type","apikey"}, body := '{}'))`.
- Remove/replace the stale migrations referencing `bruyccrjymmpzulqhotw` to prevent a future migration replay from re-creating a job against the wrong host.
- `check-unattended-orders`: pass `contentSid` + `contentVariables` to `sendTwilioMessage`; fall back to free-form only when a recent inbound session exists.
- Vendor banner: query `vendor_whatsapp_alerts` for the vendor; eligibility = no verified+enabled row; reuse `VendorWhatsAppAlerts` component/`vendor-alert-phone` function; no schema change required beyond an optional dismissal marker.
