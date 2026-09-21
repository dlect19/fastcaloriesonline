# Why the two 3:19 pm voice notes failed (read-only diagnosis)

Nothing was edited, deployed, resent or charged. Both voice notes downloaded fine — the failure happened at transcription.

## What the evidence shows

Two attempts, both refused with the same error:

| Message ID | Time (UTC, 21 Sep) | Audio downloaded | Outcome |
|---|---|---|---|
| MM625c8eaa9fd0cdbc0c12f0b346059a9a | 14:19:29 | 46,951 bytes | failed, `AI_400` |
| MM99dd9fbca01de35a6987422e002a8b28 | 14:20:07 | 46,112 bytes | failed, `AI_400` |

1. **Twilio download succeeded.** Both clips arrived with real audio bytes (~46 KB each, ≈20 s). No redirect refusal, no auth error, no bad content type, no empty/oversized body, no MIME rejection. The reservation and size checks all passed.
2. **The AI step failed, twice, for the same reason.** Logs at 14:19:30 and 14:20:08:
   - `Lovable returned 403: credit_limit_reached — "Workspace credit limit reached"` → the primary AI service refused the call.
   - The code then fell back to the backup Google key, which answered `400 Invalid audio format "ogg" for audio generation. Valid formats are: [wav, mp3]`.
3. **So the real trigger is the workspace AI credit limit.** Until 18 Sep, voice notes transcribed successfully (six `TRANSCRIBED` rows that day) on the same model and same OGG format. Nothing about the voice code changed since; the credit limit is new.
4. **Second, latent bug:** the backup path sends audio through an interface that only accepts `wav`/`mp3`, while WhatsApp always sends OGG/Opus. So whenever the primary service is unavailable, every voice note fails regardless of quality.
5. **Message mapping is misleading.** An AI/provider failure returns the generic "I couldn't quite hear that voice note… quieter spot" text. The customer is told their recording was bad when in fact our AI budget ran out. Decoding, language detection, timeouts and rate limits were not involved (failure was immediate, ~0.5 s).
6. **No customer audio or signed URLs are logged or stored.** Logs contain only hostname, message ID, byte count and outcome code; the database row stores size, status, outcome and model. The audio itself is held in memory only. Verified, nothing exposed.
7. **Cost:** no successful AI call, so no transcription cost. Each clip reserved once and finalized once — the retry protection worked.

## Narrow safe fix (not performed)

1. **Unblock the AI budget** — raise or reset the workspace credit limit. This alone restores voice notes to the behaviour that worked on 18 Sep. It is a settings change, not code.
2. **Make the backup path handle WhatsApp audio**, in `supabase/functions/_shared/ai-call.ts`: when a message carries audio, call Google's native endpoint with the audio attached as inline data (which accepts `audio/ogg`) instead of the wav/mp3-only compatibility interface. No change to the allowed formats, size caps, host checks or reservation logic.
3. **Stop calling a service failure "inaudible"** in `supabase/functions/whatsapp-webhook/voice.ts`: keep the "quieter spot" wording only for genuinely silent clips (`NO_SPEECH`, `TOO_SHORT`), and for `AI_FAILED` reply with a short honest line ("I can't listen to voice notes right now — please type your message"). Wording only; no change to gating or cost rules.

Tests to add: OGG audio through the backup path reaches the native endpoint with inline audio; a provider failure produces the service-unavailable text, not the inaudible text; silent clips still produce the inaudible text; oversized, wrong-host and wrong-MIME clips stay refused exactly as today.

## Evidence gaps

None material. Google's exact per-call accounting is not visible because the call was rejected before processing.
