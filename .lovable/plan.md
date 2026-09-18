# Voice notes: why they still fail, and the one-line correction

Read-only diagnosis of the two newest failed voice notes from the customer ending 7744. Nothing was edited, deployed, resent or downloaded.

## What the evidence shows

Two fresh attempts, both refused before any download:

| Message ID | Time (UTC, 18 Sep) | Outcome |
|---|---|---|
| MM3caa2ea9e40592e549f5677b1cf2dd07 | 01:01:17 | refused at redirect |
| MM7bd7c0f57ee0107a599eb160d21d3e5b | 01:02:47 | refused at redirect |

1. **Stage and reason:** refused at the redirect check, reason code `REDIRECT_HOST_NOT_ALLOWED`. Recorded outcome on both voice-usage rows: `REDIRECT_REJECTED`.
2. **Hostnames (from the new logs, hostname only):** initial host is Twilio's authenticated media API host and passed the initial check; the redirect points at `mms.twiliocdn.com`. No path, query or signature was logged.
3. **Redirect handling:** exactly one hop attempted, HTTPS, port 443, no credentials forwarded. The condition that failed is the redirect host allowlist — the approved patterns cover `media*.twiliocdn.com`, `mcs*.twilio.com`, `media*.twilio.com`, `mcs*.twiliocdn.com`, `api.twilio.com` and Twilio's signed S3 bucket patterns. `mms.twiliocdn.com` matches none of them, so the signed-storage branch was never reached.
4. **Target type:** a Twilio-owned CDN media host (`mms.twiliocdn.com`) — not `mcs.*.twilio.com`, not `media.twiliocdn.com`, not S3 (virtual-hosted or path-style), not CloudFront, not third-party.
5. **DNS / IP / private-network checks:** did not cause the rejection. The host is a normal public DNS name, not an IP literal, loopback, private range or metadata endpoint.
6. **Download:** never happened. So MIME type, content length, empty body, HTML/XML error body, duration, codec and transcription are all irrelevant here — none of them ran.
7. **Reservation and cost:** each attempt reserved once and was finalized once as `failed` within roughly half a second, with no bytes and no duration. Zero cost events exist for either message ID — the customer was not charged and no AI or transcription cost was recorded. Independent reservation per message ID also confirms the second attempt was not suppressed as a duplicate.
8. **Deployment freshness:** confirmed current. These log lines carry the normalized `host` field and the `wa_voice_media_refused` event name, which only exist in the code deployed a few minutes earlier. The earlier 00:44 failures show the same reason but predate the new logging. So the new deployment served these requests — this is a genuinely narrow allowlist, not a stale instance.

## The smallest safe correction (not performed)

Add Twilio's MMS media CDN host family to the **redirect** allowlist only:

- `mms.twiliocdn.com` and region-aware forms (`mms.<region>.twiliocdn.com`), matched exactly like the existing `media*.twiliocdn.com` pattern.

Nothing else changes: the initial URL stays restricted to the authenticated Twilio API/media origins, one hop only, HTTPS only, no credentials forwarded on the hop, all SSRF and private-network blocks intact, and every size, MIME, body-sanity, duration and 5 MB check unchanged. Signature verification, rate limits and cost gates are untouched.

Tests to add alongside it: redirect to `mms.twiliocdn.com` accepted and reaching transcription; regional `mms.us1.twiliocdn.com` accepted; a lookalike such as `mms.twiliocdn.com.evil.tld` refused; `mms` host over plain HTTP refused; `mms` host as an initial URL still refused.

## Evidence gaps

None material. Path, query and signature are deliberately not logged and were not needed. The only thing not observable from logs is Twilio's exact HTTP status code on the redirect (301 vs 302 vs 307) — it is not recorded, and it does not affect the diagnosis, since all of 301/302/303/307/308 are accepted and the refusal happened on the host check.
