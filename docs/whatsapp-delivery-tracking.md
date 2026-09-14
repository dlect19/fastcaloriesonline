# WhatsApp delivery tracking follow-up

## Implemented
- Migration `drizzle/migrations/0016_whatsapp_secure_delivery_tracking.sql`: random per-order tracking token, scoped read-only tracking RPC, hardened legacy public tracking lookup, RLS-protected delivery event outbox and authoritative order status/rider trigger.
- `_shared/orderTracking.ts`: customer-scoped live lookup, secure link builder and deterministic messages; no customer address, rider phone, plate or handoff code exposed.
- `whatsapp-webhook/tools.ts`: tracking in wallet/hosted checkout confirmations and idempotent checkout responses; five live tracking/status/rider/ETA tools. `agent.ts`: fresh lookup requirements. `index.ts`: production signature verification fails closed without auth token.
- `whatsapp-delivery-update/index.ts`: capability-authorized event dispatch, conditional pending-to-sending claim, shared Twilio transport, terminal event records; stale events suppressed.
- `notify-order-update/index.ts`: removed old duplicate customer WhatsApp sends; existing push/vendor behavior retained.
- `src/pages/Track.tsx`: existing route reused, read-only token lookup, 20-second refresh, pickup hides rider steps, actual recent GPS link only while picked up/on the way.
- Existing assisted-order link generators updated in both edge functions and admin detail/list pages. Generated Supabase types and function config updated.

## Verification
13 new mocked/source-contract tests and 25 existing rules/agent tests passed (38 total). Edge Deno checks and application type check passed. Five affected edge functions deployed. No real orders, payments, rider assignments or outbound test messages were created.

## Unresolved gaps / operational assumptions
- No approved lifecycle-specific WhatsApp template was verified/configured. Outside the 24-hour customer window, events are blocked with an explicit reason rather than using an unrelated template. Approval/configuration is required for reliable proactive updates outside that window.
- Deduplication is at-most-once dispatch, not guaranteed delivery: unknown transport outcomes remain sending; failed/blocked events are recorded but not automatically retried. Pending HTTP dispatch failure needs operational replay. No automatic recovery worker or delivery receipt reconciliation added.
- Current schema has no supported nearby/arriving or delivery-issue event used here. Supported statuses: confirmed, preparing, ready_for_pickup, searching_for_rider, assigned, picked_up, on_the_way, delivered, cancelled.
- GPS uses existing coordinates and rider profile updated_at freshness, not a dedicated GPS timestamp. This timestamp can change for non-location updates; a dedicated location timestamp would improve precision. No synthetic ETA or GPS is generated.
- Legacy public links containing sequential order numbers now require the authenticated owner; newly shared links use tokens. Existing publicly shared links need reissuing.
- Order/rider event uniqueness suppresses repeat visits to the same status or same rider assignment. Reassignment to a different rider generates another event.
- Tokens are bearer read-only links and do not expire automatically. They reveal only the scoped projection and grant no mutation/payment capability.
- Existing vendor notification transport and older push trigger credential handling remain unchanged; they warrant a separate security review.
- Tests cover mocks and source contracts; database concurrency, trigger dispatch, Twilio delivery, and complete checkout were not exercised live.
