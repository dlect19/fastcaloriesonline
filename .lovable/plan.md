## Admin Security: 2FA + Activity Monitoring (Super Admins)

### Scope
- **Who:** Mandatory for `super_admin` only. Regular `admin` staff keep current login.
- **Delivery:** Admin chooses **Email OTP** or **Authenticator app (TOTP)**. Email is the default fallback if TOTP not enrolled.
- **Hardening:** Login activity log + email alert on new device, and 15-min auto-lock after 5 failed OTP attempts.

---

### 1. Database (new tables)

- `admin_2fa_settings` — one row per admin: `preferred_method` (`email` | `totp`), `totp_secret` (encrypted-at-rest via vault), `totp_enabled`, `backup_codes` (hashed jsonb), `enrolled_at`.
- `admin_otp_codes` — pending email OTPs: `code_hash`, `expires_at` (10 min), `used`, `attempts`, `ip`, `user_agent`.
- `admin_login_activity` — every successful login: `ip`, `user_agent`, `device_fingerprint` (sha256 of UA+IP), `was_new_device`, `location_city`, `created_at`.
- `admin_login_attempts` — every attempt (success/fail) for lockout & audit: `email`, `outcome`, `failure_reason`, `ip`, `created_at`.
- `admin_lockouts` — active locks: `user_id`, `locked_until`, `reason`.

All locked behind RLS — only the row owner + super admins via `has_role` can read; writes are service-role only.

### 2. Edge functions

- `admin-2fa-initiate` — called right after password verify. Looks up `admin_2fa_settings`; if TOTP enabled returns `{method:'totp'}`; otherwise generates a 6-digit email OTP, stores hashed, and sends via existing transactional email queue. Also checks `admin_lockouts`.
- `admin-2fa-verify` — accepts `{code, method}`. Verifies TOTP (RFC 6238) or hashed email OTP. On success: writes `admin_login_activity`, compares device_fingerprint to last 30 days, fires `admin-new-device-alert` email if new, clears failed counter, returns `{verified:true}`. On failure: increments `admin_login_attempts`; at 5 fails in 15 min inserts `admin_lockouts` row (locked_until = now + 15 min).
- `admin-2fa-enroll-totp` — generates secret + `otpauth://` URI + QR payload (base32). Returns to client; not enabled until first code confirmed.
- `admin-2fa-confirm-totp` — verifies first TOTP code and flips `totp_enabled=true`, generates 8 backup codes (hashed, returned plaintext once).
- `admin-2fa-disable` — requires current TOTP/OTP + records in activity log.

All functions validate the caller is a super_admin via JWT before doing anything.

### 3. Frontend changes

- **`src/pages/admin/AdminAuth.tsx`**: after `signInWithPassword` succeeds, if user is super_admin → call `admin-2fa-initiate`, do **not** navigate yet, show a new `<Admin2FAChallenge>` step with 6-digit input (or "Open authenticator app" hint). On verify success → navigate to dashboard. Lockout message if returned.
- **New `src/components/admin/Admin2FAChallenge.tsx`** — pin input, resend (email only), countdown.
- **New `src/pages/admin/AdminSecurity.tsx`** (route `/admin/security`) — manage preferred method, enroll TOTP (QR + confirm), regenerate backup codes, view last 20 login events, view active lockouts. Linked from admin sidebar.
- **New `src/components/admin/Admin2FAEnrollDialog.tsx`** — QR + manual secret + first-code confirm + backup-codes display.

### 4. Email templates
Use the existing transactional email pipeline (`send-transactional-email`) with two new templates:
- `admin_otp_code` — "Your sign-in code: 123456 (expires in 10 minutes)".
- `admin_new_device_login` — "New sign-in to your admin account from {device} at {ip} on {time}. If this wasn't you, change your password."

### 5. Auto-lockout behavior
- Counted per `user_id` (not IP) over a 15-min sliding window.
- On 5th failure: 15-min lock + alert email to the admin.
- `admin-2fa-initiate` short-circuits with `{locked:true, until:…}` if lock is active.
- Super admins can manually unlock another admin from the Security page.

### 6. Out of scope (for this pass)
- Trust-device-for-30-days (user opted out).
- SMS OTP, hardware keys, WebAuthn — can come later.
- Forcing 2FA on regular admins — only Super Admins per your choice.

---

### Files touched
- 1 migration (5 tables + RLS + helper fn `is_admin_locked_out`)
- 5 new edge functions under `supabase/functions/`
- 2 new email templates registered with the email registry
- `AdminAuth.tsx` (modified), 3 new components, 1 new page + route in `App.tsx`, sidebar link in `AdminSidebar`.

Ready to build it as described, or adjust anything first?