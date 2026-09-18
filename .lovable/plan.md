# WhatsApp voice notes: diagnosis of the two failed clips (read-only)

## What happened

Two voice notes from the same customer (number ending 7744) failed within 32 seconds of each other, just after midnight UTC on 18 Sep 2026. Both got the "I couldn't open that audio file" reply. They were two genuinely separate attempts, not one message counted twice.

The audio was never even downloaded. Our own safety rule blocked it: WhatsApp/Twilio hands us a link that immediately forwards to a second download address, and our list of approved addresses does not include the one Twilio forwarded to. So we refused the file before any transcription happened.

Nothing was charged. No transcription ran, no AI cost was recorded, and both attempts were properly closed out as failed, so nothing is stuck or double-counted.

## Evidence

| Attempt | Time (UTC) | Message ID | Outcome | Size | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | 00:44:00 | MM5b7f58… | REDIRECT_REJECTED / failed | not recorded (never downloaded) | none |
| 2 | 00:44:32 | MMde659b… | REDIRECT_REJECTED / failed | not recorded (never downloaded) | none |

- Function logs show `[wa-voice] refused redirect target` at both timestamps, immediately after an authenticated inbound webhook (`sig= yes`), so the request was genuine and signature verification passed.
- Voice notes are switched on and no limit was hit: enabled = true, 5 MB cap, 120 s cap, 3/min, 20/hour, 60/day per number, 10 concurrent, 2000/day platform. Neither attempt was refused for limits.
- Both message IDs are distinct, so same-ID replay protection did not suppress the second try — each was independently reserved and independently failed.
- No rows exist for either message ID in the AI cost ledger: the customer was not costed and no order fee was affected.
- The separate prescription-image path in the same function follows redirects normally and works, which is consistent with Twilio media links legitimately redirecting to a different download host.

## Root cause (ranked)

1. **Most likely (matches the recorded outcome exactly):** the redirect target host allowlist is too narrow. Voice download only permits `api.twilio.com` and `media.twiliocdn.com`; Twilio's media endpoint answers with a 30x to its media storage host (historically an S3-backed or `mcs.*.twilio.com` address), which is refused. This is a configuration/assumption bug on our side, not a customer or codec problem.
2. Less likely: the redirect points at a valid Twilio host but with a form the matcher mishandles (case, port, or a region subdomain). Same fix covers it.
3. Ruled out by evidence: limits, disabled switch, unsupported codec, corrupt audio, transcription/gateway failure, duplicate-suppression — all of those produce different recorded outcomes, and none appear.

The one thing the logs deliberately do not record is the actual redirect hostname (it was omitted to avoid logging signed URLs). That is the single missing piece, so the fix starts by capturing it safely.

## Smallest safe fix (not applied in this turn)

1. Log the refused redirect's hostname only — never the path, query or signature — so the exact target is known from the next occurrence.
2. Widen the redirect allowlist to Twilio's documented media download hosts (including regional `mcs.*.twilio.com` and Twilio's media storage host), while keeping:
   - the initial request restricted to Twilio API/CDN hosts,
   - HTTPS only, one redirect hop only, no credentials sent to the redirect target,
   - the existing size cap, timeout, MIME allowlist and per-message reservation.
3. Alternative if the redirect target turns out to be a generic storage host we do not want to allowlist broadly: fetch the media through the Twilio media metadata endpoint and use the connector gateway instead of following the raw redirect.
4. Add tests: a Twilio media redirect to the real download host is accepted; an unrelated host is still refused; credentials are not forwarded on the redirect; a refused redirect still finalises the reservation.

No production data, reservations, orders, payments or messages are touched by this diagnosis, and the customer can already work around it by typing their order.

## Answers to the specific questions

- **Affected stage:** media fetch, at the redirect check — before decoding and before any AI call.
- **Charged/costed:** no. Zero cost rows, no order fee, no wallet movement.
- **Reservations:** both released correctly (status `failed`, finalised within a second).
- **Other customers:** these are the only two such failures in the voice usage records, so no wider impact is visible.
