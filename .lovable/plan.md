## What we're building

**1. Admin "Push via WhatsApp" button (Assisted Order detail)**
- Keep the existing green wa.me "Send via WhatsApp" button (opens the operator's WhatsApp).
- Add a new button **"Push via Twilio"** next to it that silently POSTs the exact same customer message to the customer's WhatsApp through our existing `whatsapp-send` edge function (uses the official FastCalories Twilio number).
- Shows a toast on success/failure and logs the call to the new tracking table (see #3).

**2. Blue verified tick on profile avatars — verified accounts only**
- New reusable component `src/components/shared/VerifiedAvatar.tsx` that renders an avatar with a blue check overlay when `verified === true`.
- New hook `src/hooks/useIsVerified.ts` that resolves verification for a `user_id`:
  - **Customer**: `profiles.email` present AND `profiles.phone_verified_at IS NOT NULL`.
  - **Vendor owner / staff**: vendor row with `status = 'approved'`.
  - **Rider**: `rider_profiles.status = 'approved'`.
- Wire the badge into the highest-traffic surfaces first:
  - Vendor sidebar header (image 2 — the circled icon).
  - `ProfileHeader.tsx` (customer profile).
  - `AdminLayout` / rider layout headers.
  - Vendor cards on Home / Explore / VendorDetail (small badge on vendor logo).
- No badge shown when unverified — no red/grey state.

**3. Per-user Twilio cost tracking + admin report**
- New table `twilio_api_logs`:
  - `user_id` (uuid — the person the message was sent to OR on behalf of),
  - `initiated_by` (uuid — admin/vendor/system actor),
  - `direction` (`out` / `in`), `channel` (`whatsapp` / `sms`),
  - `to_phone`, `from_phone`, `body_preview` (first 120 chars),
  - `twilio_sid`, `twilio_status`, `segments`, `price_ngn` (numeric),
  - `function_name`, `error`, `created_at`.
- Estimated cost per send (config in `platform_settings`, defaults):
  - WhatsApp: ₦25/msg. SMS: ₦20/segment × segments.
- Instrument every outgoing Twilio call:
  - `whatsapp-send`, `send-phone-otp`, and the new push-from-admin path all write one row.
- New admin page `src/pages/admin/AdminTwilioCosts.tsx` at `/admin/twilio-costs`:
  - Top cards: total sends, total ₦ spent (today / 7d / 30d / all time).
  - Table grouped by user (name, phone, role, message count, total ₦), sortable, paginated, date filter.
  - Row drilldown: recent messages for that user with body preview + status + cost.
- Add sidebar link under Admin → "Twilio Costs".

## Technical notes

- Verified logic runs via a single SECURITY DEFINER SQL function `public.is_user_verified(_user_id uuid)` returning boolean, so the hook is one round trip.
- `useIsVerified` batches by memoizing per user_id in a small `React.useContext` cache to avoid N+1 on list pages.
- `twilio_api_logs` RLS: only admins can read; edge functions insert via service role.
- Cost calc lives in a shared helper `supabase/functions/_shared/twilioCost.ts` so all senders record the same numbers.
- No changes to Twilio itself — we already have the connector wired.

## Out of scope (unless you ask)
- Badge on order chat bubbles / review author lines.
- Real invoice reconciliation against Twilio's actual billing (we log our *estimate*; can add a nightly reconcile job later).
