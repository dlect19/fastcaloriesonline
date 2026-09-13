# WhatsApp one-time-code template rejection — investigation findings

Investigation only. Nothing was created, deleted, resubmitted, or changed.

## What the live setup actually looks like

- Twilio account: `AC99f3…a0d4` (one account, not a sandbox-only setup).
- Live WhatsApp business number: **+234 810 312 8494**, status **ONLINE**, quality rating **HIGH**, webhooks pointing at the FastCalories backend. This is the production sender and it is healthy.
- A second entry exists for Twilio's shared sandbox number (+1 415 523 8886), status OFFLINE — unused.
- Both entries report the same WhatsApp business account (WABA) id `13371753…3071`.
- Sending limit on the live number: **250 customers / 24 hours** — the tier Meta gives a business account whose **business verification is not completed**.
- No messaging-service sender association is involved; sends go direct from the number.

## Why the code template was rejected

- The template `fastcalories_otp_auth_v1` (`HXaf12…5d4c`) is correctly built: content type `whatsapp/authentication`, category `AUTHENTICATION`, copy-code button, 10-minute expiry.
- Meta's reply: `code=10, subCode=2388185 — This WhatsApp business account does not have permission to create message template`.
- On the **same account and same WABA**, three plain-text UTILITY templates (`vendor_new_order`, `vendor_unattended_order`, `vendor_daily_summary`) are **approved**, and the menu/button templates were rejected only for content reasons (`subCode=2388060`, buttons can't contain variables/emojis). So Meta is accepting and processing template creation from this WABA in general.

**Conclusion:** the WABA has not lost template permission, and the templates were not created under a different WABA or account. The restriction is specific to the **AUTHENTICATION** template category, which Meta only grants to a WhatsApp business account whose **business is verified** (consistent with the 250/24h unverified tier seen on the live number). No sandbox/ownership mismatch, no sender fault.

## Smallest external action required

1. In Meta Business Manager, for the business that owns WABA `13371753…3071`, complete **Business Verification** (legal name, business documents, matching website/contact details) and confirm the WABA is fully owned by that business rather than left in a shared/partner state. Verification typically lifts the 250/24h tier and enables authentication-category templates.
2. Only after verification shows complete: resubmit the same authentication template — no code or template changes are needed.

## Interim, if codes must work before verification

Add a Twilio SMS-capable sender number as `TWILIO_SMS_FROM` in Project Settings → Secrets. The system already falls back to SMS for codes when that value exists; until then it correctly refuses to send codes rather than pretending.

No workaround of the Meta restriction and no fake approval status was introduced.
