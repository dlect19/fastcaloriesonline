# Voice note worked — the chat assistant is what failed

## What the logs and records actually show

The new voice fix is working. Two voice notes from the same customer were transcribed successfully after the deploy:

- 14:37:19 UTC, 42,260 bytes, outcome TRANSCRIBED, model google/gemini-3.5-flash
- 14:38:24 UTC, 36,049 bytes, outcome TRANSCRIBED, model google/gemini-3.5-flash

Both went through the new native Google audio path (`[ai-call] Calling native Gemini fallback (inline audio)...` at 14:37:20 and 14:38:24). No AI_400, no media failure, no empty audio. The earlier 14:19/14:20 AI_400 rows are the pre-fix failures.

The message the customer saw — "WhatsApp AI error: no output generated check the stream for error" — came from the **ordering assistant**, not the voice step. After the voice note was turned into text, the assistant call failed:

- Lovable AI gateway returned **403 Forbidden — credit_limit_reached, "Workspace credit limit reached"** (logged 14:37:20 and 14:38:24, model google/gemini-3.8-flash, run ids 01a0c466-74bd-738d-a6c1-ce03b81b0bf3 and 01a0c467-779a-7c05-99b3-37a405c4d963).
- The AI toolkit turned that into its internal message "No output generated. Check the stream for errors.", and `supabase/functions/whatsapp-webhook/agent.ts` line 189 pastes any failure message straight into the customer reply.

No streaming/parsing bug, no consumed-response bug, no uncaught crash. Nothing sensitive was logged: logs contain only session id, model, run id and byte counts — no audio, base64, media links, keys or message text.

Two real problems remain, both in the assistant path:

1. Customers are shown raw internal developer text on any AI failure.
2. Unlike the voice/transcription path, the assistant has **no Google fallback**, so while the workspace AI credit limit is reached every typed and spoken order request fails.

## Proposed changes

### 1. Honest customer wording (small, safe)
In `supabase/functions/whatsapp-webhook/agent.ts`, stop echoing the provider/toolkit message to the customer. Reply instead with a short truthful line, e.g. "I'm having trouble reaching my assistant right now. Please send that again in a moment." Keep the full technical detail (status, message, run id) in the server logs for diagnosis. Payment, cart and order behaviour unchanged — a failed assistant turn already changes nothing.

### 2. Fallback to Google for the assistant, matching the voice path
Give the assistant the same provider fallback the shared AI helper already has: when the Lovable gateway answers 402/403/429, retry the same request against Google with the project's own key, preserving tools, the system prompt, history limits, token-usage accounting and run-id logging. This is what keeps WhatsApp ordering alive while the workspace credit limit is reached.

If you'd rather not touch the assistant's model plumbing today, step 1 alone is a one-line-scope change and I can ship it on its own — but WhatsApp ordering stays broken until the workspace AI credit limit is raised.

## Not part of this plan
- No change to the workspace credit limit (that is a settings decision for you).
- No change to voice handling, payments, checkout, outlet rules or security controls.

## Technical notes
- Failure surface: `supabase/functions/whatsapp-webhook/agent.ts` lines 179-192 (`catch` builds `WhatsApp AI error...` from `failure.message` / `responseBody`). `statusCode` is undefined here because the toolkit wraps the 403, which is why the customer text carried no code.
- Assistant model: `google/gemini-3.8-flash` via `createOpenAICompatible` at lines 120-133, `streamText` with `maxRetries: 0` at line 151.
- Reusable fallback logic already exists in `supabase/functions/_shared/ai-call.ts` (`callGemini`, `callGeminiNativeChat`, `hasAudioPart`); the assistant uses the AI SDK instead, so the fallback needs an equivalent provider switch rather than a copy.
- Tests to add: gateway 403/429 produces the customer-safe text and never the toolkit wording; the fallback provider is used on 402/403/429 with tools intact; a successful first call never triggers the fallback; no secrets or audio in logs.
- Verification: full test suite, typecheck, Deno checks, then deploy `whatsapp-webhook` only.
