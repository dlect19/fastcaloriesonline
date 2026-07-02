## Goal

Verify every user's phone number via a 6-digit OTP sent through WhatsApp (with SMS fallback), let admins force existing and new users to complete verification before continuing, and allow brand-new accounts to be created directly from the WhatsApp bot.

## 1. Database

Migration `phone_verification`:

- `profiles`: add `phone_verified boolean default false`, `phone_verified_at timestamptz`, `phone_verification_method text` (`whatsapp` | `sms`).
- New table `phone_verification_otps` (`id`, `user_id nullable`, `phone e164`, `code_hash`, `attempts int default 0`, `channel text`, `expires_at`, `verified_at`, `created_at`). RLS: only service-role writes; user can read own by `user_id`. Standard GRANTs.
- `platform_settings`: new key `force_phone_verification` (`off | customers | professionals | all`).

## 2. Edge functions

- `send-phone-otp` — input `{ phone, purpose: 'verify' | 'signup' | 'login' }`. Rate-limit (max 3 / 5min). Generate 6-digit code, hash, insert row (10-min expiry). Try WhatsApp via existing `send-whatsapp` (uses `TWILIO_WHATSAPP_FROM`). On WhatsApp failure (unregistered number, template not approved, undelivered) automatically fall back to SMS via Twilio (`TWILIO_SMS_FROM` — request if missing). Return `{ channel, expires_at }`.
- `verify-phone-otp` — input `{ phone, code, userId?, signup? }`. Look up latest unverified OTP for phone, compare hash, increment attempts (block after 5), mark verified. If `signup=true` and no `auth.users` row exists for that phone, create the user via service role with a random password, insert a `profiles` row (`phone_verified=true`), and return a magic-link / one-time session token so the WhatsApp bot / web can log them in. If `userId` given, flip `profiles.phone_verified=true`.
- Update existing `whatsapp-webhook` to intercept messages of the form `verify <6-digit>` for numbers with a pending OTP and auto-call `verify-phone-otp`, replying "✅ Your phone is verified".

## 3. Frontend — verification flow

- `src/components/auth/PhoneVerificationDialog.tsx`: two-step dialog — enter WhatsApp number → enter code. Copy states clearly: *"Use the same number you have on WhatsApp — we'll message you a 6-digit code there."* Shows countdown + "Resend via SMS" after 30 s.
- `src/hooks/usePhoneVerification.ts`: wraps the two edge functions and returns `{ verified, sendOtp, verify, cooldown }`.
- `src/components/auth/PhoneVerificationGate.tsx`: mounted in `App.tsx` after auth loads. Reads `platform_settings.force_phone_verification` + current user's `profiles.phone_verified` + user's role scope. If the setting requires verification and the user isn't verified, render the dialog fullscreen and block all other routes until verified.
- `checkout` guard: even when the global setting is `off`, refuse to place an order if the checkout customer's phone isn't verified — small inline verify banner in `CheckoutPage`.

## 4. Admin controls

`src/pages/admin/AdminPhoneVerification.tsx` (linked in admin sidebar under Settings):

- Toggle `force_phone_verification` with 4 options (`off`, `customers`, `professionals`, `all`, `all + new signups`).
- Stat cards: total users, verified, unverified, verified today.
- Table of unverified users with a "Send OTP" button (admin-triggered `send-phone-otp`).
- Audit trail written to `activity_logs`.

## 5. WhatsApp signup

Extend `whatsapp-webhook` state machine: if an inbound message comes from a number **not linked to any `auth.users` row**, offer a "🚀 Reply *SIGNUP* to create an account". On `SIGNUP`, call `verify-phone-otp` with `signup=true` (phone already proven by the fact they're messaging us via WhatsApp — no OTP needed here) to auto-provision the account, then reply with a one-time login link (`/wa-login?token=…`) that hydrates a Supabase session in the browser. On the web side, first login prompts them to add email + password ("Add web login credentials — optional") through a small `AddWebCredentialsCard` in the profile page; the WhatsApp channel keeps working regardless.

## 6. Secrets to request

- `TWILIO_SMS_FROM` — E.164 SMS sender number (only if not already stored).

## 7. UI copy highlights

- Signup form phone field: helper text "Must be the same number you use on WhatsApp — we'll send the verification code there."
- Verification dialog title: "Verify your WhatsApp number".
- If WhatsApp fails: toast "Couldn't reach you on WhatsApp — we sent the code by SMS instead."

## Out of scope

- Changing verification of numbers already collected via Paystack/DVA flows (they'll simply run through the same gate on next login).
- Voice-call OTP fallback.
