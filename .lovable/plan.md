# WhatsApp Ordering System via Twilio

A conversational ordering channel that lets customers browse vendors, build a cart, checkout, and receive live order updates entirely from WhatsApp — reusing the existing FastCalories order, payment, dispatch, and notification infrastructure.

## Scope (Phase 1 — shipped now)

This is a large surface area. To deliver something working and avoid a half-built system, Phase 1 ships the core end-to-end flow. Phase 2 items are listed but not built yet.

### Phase 1 — Core flow
1. Twilio connector wiring (WhatsApp send/receive via Twilio Messages API through the Lovable connector gateway).
2. Inbound webhook edge function `whatsapp-webhook` (public, signature-verified) that:
   - Parses Twilio webhook payloads.
   - Resolves/creates a `whatsapp_session` keyed by phone number.
   - Routes messages through a state machine (menu → vendor list → menu items → cart → checkout).
3. Outbound sender edge function `whatsapp-send` (internal, used by triggers and admin) that posts to Twilio.
4. Conversation state machine supporting:
   - `Hi` → main menu (Order / Track / Nearby vendors / Healthy suggestions / Support).
   - Nearby vendors (reuses existing nearby-outlet logic, top 5 by distance).
   - Vendor menu listing (numbered, price + calories).
   - Cart add / remove / qty / view.
   - Checkout → generates a Paystack payment link reusing the existing wallet/order flow, replies with URL.
5. Order linkage: on successful payment webhook, mark the WhatsApp order as paid and reply with confirmation. Subscribe to `orders` status changes (DB trigger → `whatsapp-send`) for: confirmed, preparing, rider assigned, nearby, delivered.
6. AI meal suggestions: free-text like "low calorie breakfast" routed to Lovable AI (`google/gemini-2.5-flash`) with vendor menu context, returns top 3 picks with add-to-cart shortcuts.
7. Admin page `/admin/whatsapp` with tabs:
   - Active sessions (phone, last activity, current state, cart items).
   - Order logs (WhatsApp-originated orders).
   - Twilio status (uses connector verify endpoint).
   - Toggle: enable/disable WhatsApp ordering globally (platform setting).
   - Basic conversion stats (sessions started → orders placed → paid).
8. Security: Twilio request signature validation, per-phone rate limit, session TTL (30 min idle), duplicate-submission guard via idempotency key on order creation.

### Phase 2 — Not in this build (call out to user)
- Multi-package orders inside WhatsApp (complex UX — needs separate pass).
- Rider/vendor receiving WhatsApp notifications (currently they get in-app + push; can extend later).
- Voice ordering, multi-language, marketing broadcasts.
- Twilio Business API onboarding (sandbox works for dev; production requires Meta-approved templates and a verified WhatsApp sender — user-side setup).

## Database changes

New tables (all RLS-enabled, admin-only via `has_role`):

- `whatsapp_sessions` — `phone`, `customer_user_id` (nullable, linked when matched), `state` (enum-ish text: `idle|menu|browsing_vendors|browsing_menu|cart|checkout`), `context` (jsonb: selected_vendor_id, last_menu_page, etc.), `cart` (jsonb array), `last_message_at`, `expires_at`.
- `whatsapp_messages` — `session_id`, `direction` (`in|out`), `body`, `twilio_sid`, `created_at`. (Logging + admin view.)
- `whatsapp_orders` — `session_id`, `order_id` (FK to existing `orders`), `payment_link`, `status`, timestamps. Bridge so existing orders stay untouched.
- `platform_settings` row: `whatsapp_ordering_enabled` boolean (or extend existing settings table if present).

Trigger: on `orders` status change, if `orders.id` exists in `whatsapp_orders`, enqueue an outbound message via `pg_net` → `whatsapp-send`.

## Edge functions

- `whatsapp-webhook` (verify_jwt=false, public): receives Twilio inbound, validates signature using `TWILIO_AUTH_TOKEN`, dispatches to state machine, replies via TwiML or async send.
- `whatsapp-send` (verify_jwt=true, internal): posts message via Twilio connector gateway. Used by triggers and admin actions.
- `whatsapp-checkout` (verify_jwt=false, called from state machine): creates a pending order + Paystack init, returns hosted payment URL. Reuses existing payment-init helpers.

All Twilio calls go through the connector gateway pattern (`https://connector-gateway.lovable.dev/twilio/Messages.json`) using `TWILIO_API_KEY` + `LOVABLE_API_KEY`.

## Frontend

- `src/pages/admin/AdminWhatsApp.tsx` — sessions table, message log drawer, stats cards, enable/disable toggle, Twilio status pill.
- Sidebar entry under Admin → "WhatsApp" (icon: MessageCircle).

## Technical details

- Session TTL: 30 min sliding; cron-free approach using `expires_at` checked on each inbound message.
- Idempotency: WhatsApp message `MessageSid` deduped via unique index on `whatsapp_messages.twilio_sid`.
- Phone normalization: E.164 stripping `whatsapp:` prefix before matching to `profiles.phone`.
- Distance/nearby vendors: reuses existing `nearby_outlets` logic via RPC, capped to 5 results.
- Payment link: uses existing Paystack init flow, callback URL marks the bridged order paid and triggers WhatsApp confirmation.

## Required setup from user

1. **Twilio connector** — connect via the Twilio integration so `TWILIO_API_KEY` is injected. We'll prompt during build.
2. **TWILIO_AUTH_TOKEN secret** — needed for inbound webhook signature verification (separate from the connector API key). Will request via secrets tool.
3. **Webhook URL** — after deploy, paste the `whatsapp-webhook` URL into Twilio Console → WhatsApp Sandbox → "When a message comes in".

## Out of scope confirmation

Phase 2 items above will not be built in this pass. If you want any of them now (especially multi-package WhatsApp orders), say which and I'll fold them in.
