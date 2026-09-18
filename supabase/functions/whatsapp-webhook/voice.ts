// Env read via globalThis so this module also typechecks outside Deno.
const envGet = (k: string): string | undefined =>
  (globalThis as any).Deno?.env?.get(k);

// WhatsApp voice-note support with server-authoritative cost gating.
//
// Every expensive step is bounded and reserved BEFORE it runs:
//  * a master switch and all limits live in platform_settings (admin-editable),
//  * one reservation per provider MessageSid, so a Twilio retry never
//    transcribes (or bills) the same clip twice,
//  * media is fetched only from Twilio's own origins, following at most ONE
//    redirect and only to a Twilio-owned media store (see mediaFetch.ts) with
//    the Twilio credentials deliberately NOT forwarded,
//  * a streaming byte cap, a request timeout and a body sanity check,
//  * only allowlisted audio MIME types are accepted,
//  * usage is recorded redacted (size and outcome, never the audio itself).

import { chatCompletionWithFallback } from "../_shared/ai-call.ts";
import {
  checkInitialMediaUrl,
  checkRedirectTarget,
  isDisallowedMediaContentType,
  isRedirectStatus,
  looksLikeMediaBytes,
  readCapped,
} from "./mediaFetch.ts";

export { isAllowedMediaUrl } from "./mediaFetch.ts";

const AUDIO_MIME_PREFIX = "audio/";
import { WHATSAPP_TRANSCRIBE_MODEL } from "./models.ts";
const TRANSCRIBE_MODEL = WHATSAPP_TRANSCRIBE_MODEL;

/** Audio types WhatsApp/Twilio actually deliver. Anything else is refused. */
const ALLOWED_AUDIO = [
  "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp3", "audio/mp4",
  "audio/m4a", "audio/x-m4a", "audio/aac", "audio/amr", "audio/wav", "audio/x-wav",
];

const MEDIA_TIMEOUT_MS = 20_000;
const AI_TIMEOUT_MS = 45_000;
const MIN_AUDIO_BYTES = 1024;

export function isAllowedAudioType(contentType: string): boolean {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_AUDIO.includes(ct)) return true;
  // Some providers send audio/ogg as "audio/ogg; codecs=opus" or "audio/x-opus".
  return ct.startsWith(AUDIO_MIME_PREFIX) && (ct.includes("ogg") || ct.includes("opus"));
}

/** True when the inbound Twilio webhook carries a voice note / audio clip. */
export function detectVoiceNote(params: Record<string, string>): { url: string; contentType: string } | null {
  const num = parseInt(params["NumMedia"] || "0", 10);
  if (!num) return null;
  for (let i = 0; i < num; i++) {
    const ct = (params[`MediaContentType${i}`] || "").toLowerCase();
    const url = params[`MediaUrl${i}`];
    if (url && (ct.startsWith(AUDIO_MIME_PREFIX) || ct.includes("ogg") || ct.includes("opus"))) {
      return { url, contentType: ct || "audio/ogg" };
    }
  }
  return null;
}

function audioFormat(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "mp4";
  if (ct.includes("amr")) return "amr";
  return "ogg"; // WhatsApp default (ogg/opus)
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export interface VoiceGateResult {
  /** Transcript when the clip was accepted and understood. */
  transcript: string | null;
  /** Customer-facing text when it was not (null when transcript is set). */
  message: string | null;
  /** Machine-readable outcome for logs. */
  code: string;
  /** Model used, for cost attribution. */
  modelId?: string;
  /** Token usage exactly as the provider reported it (absent when it didn't). */
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
}

const OVER_LIMIT_TEXT =
  "🎙️ I can't take that voice note right now — please type your message instead (e.g. *2 jollof rice*). Reply *menu* anytime for the full menu.";
const TOO_LONG_TEXT =
  "🎙️ That voice note is a bit long for me. Please send a shorter one (under two minutes), or just type your message.";
const DISABLED_TEXT =
  "🎙️ Voice notes aren't available at the moment — please type your message instead. Reply *menu* for the full menu.";
const UNSUPPORTED_TEXT =
  "🎙️ I couldn't open that audio file. Please record it again with WhatsApp's microphone, or type your message.";

export const VOICE_FAIL_TEXT =
  "🎙️ I couldn't quite hear that voice note. Please record it again in a quieter spot, or just type your message — e.g. *I want 2 jollof rice*. Reply *menu* anytime for the full menu.";

/** Redacted refusal log: hostname + reason + MessageSid correlation only. */
function logRefusal(stage: string, reason: string, host: string | null, messageSid: string | null) {
  console.error(JSON.stringify({
    event: "wa_voice_media_refused",
    stage,
    reason,
    host: host || "unknown",
    message_sid: messageSid || null,
  }));
}

/**
 * Fetch inbound media from Twilio: authenticated first request to the Twilio
 * origin, then at most one manually-validated redirect hop with NO credentials
 * forwarded to the redirected host.
 */
async function fetchTwilioMedia(
  url: string,
  auth: string,
  messageSid: string | null,
): Promise<
  { ok: true; response: Response; finalHost: string } | { ok: false; reason: string; status?: number }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  let first: Response;
  try {
    first = await fetch(url, {
      headers: { Authorization: auth },
      // Never follow automatically: a redirect could point anywhere, and fetch
      // would re-send the Authorization header.
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!isRedirectStatus(first.status)) {
    return { ok: true, response: first, finalHost: new URL(url).hostname.toLowerCase() };
  }

  await first.body?.cancel().catch(() => {});
  const location = first.headers.get("location") || "";
  const verdict = checkRedirectTarget(location, url);
  if (!verdict.ok) {
    logRefusal("redirect", verdict.reason, verdict.host, messageSid);
    return { ok: false, reason: "REDIRECT_REJECTED" };
  }

  const followController = new AbortController();
  const followTimer = setTimeout(() => followController.abort(), MEDIA_TIMEOUT_MS);
  let second: Response;
  try {
    second = await fetch(new URL(location, url).toString(), {
      // Deliberately no Authorization / cookies: the signed URL carries its own
      // short-lived credentials and the target host must never see Twilio's.
      redirect: "manual",
      signal: followController.signal,
    });
  } finally {
    clearTimeout(followTimer);
  }

  if (isRedirectStatus(second.status)) {
    await second.body?.cancel().catch(() => {});
    logRefusal("redirect", "SECOND_REDIRECT", verdict.host, messageSid);
    return { ok: false, reason: "REDIRECT_REJECTED" };
  }
  return { ok: true, response: second, finalHost: verdict.host || "unknown" };
}

/**
 * Gate + transcribe. Reserves usage first (idempotent by MessageSid), enforces
 * host/MIME/size limits, then transcribes. A replayed provider delivery returns
 * a silent no-op so the customer is never answered twice.
 */
export async function transcribeVoiceNoteGated(
  supabase: any,
  args: {
    url: string;
    contentType: string;
    messageSid: string | null;
    phone: string;
    userId?: string | null;
  },
): Promise<VoiceGateResult> {
  const { url, contentType, messageSid, phone, userId } = args;

  const initial = checkInitialMediaUrl(url);
  if (!initial.ok) {
    logRefusal("initial", initial.reason, initial.host, messageSid);
    return { transcript: null, message: UNSUPPORTED_TEXT, code: "MEDIA_HOST_REJECTED" };
  }
  if (!isAllowedAudioType(contentType)) {
    return { transcript: null, message: UNSUPPORTED_TEXT, code: "MIME_REJECTED" };
  }
  if (!messageSid) {
    return { transcript: null, message: OVER_LIMIT_TEXT, code: "MESSAGE_ID_REQUIRED" };
  }

  // Reserve before any download or model call.
  const { data: reservation, error: reserveErr } = await supabase.rpc("whatsapp_voice_reserve", {
    p_message_sid: messageSid,
    p_phone: phone,
    p_user_id: userId ?? null,
  });
  if (reserveErr) {
    console.error("[wa-voice] reservation failed", reserveErr.message);
    return { transcript: null, message: OVER_LIMIT_TEXT, code: "RESERVE_FAILED" };
  }
  const gate = (reservation || {}) as Record<string, unknown>;
  if (gate.ok !== true) {
    const reason = String(gate.reason || "REFUSED");
    console.warn(JSON.stringify({ event: "wa_voice_refused", reason, phone_tail: phone.slice(-4) }));
    if (reason === "REPLAY") return { transcript: null, message: null, code: "REPLAY" };
    if (reason === "VOICE_DISABLED") return { transcript: null, message: DISABLED_TEXT, code: reason };
    return { transcript: null, message: OVER_LIMIT_TEXT, code: reason };
  }

  const maxBytes = Math.min(Number(gate.max_bytes) || 5 * 1024 * 1024, 5 * 1024 * 1024);
  const finalize = async (status: string, code: string, bytes?: number) => {
    try {
      await supabase.rpc("whatsapp_voice_finalize", {
        p_message_sid: messageSid,
        p_status: status,
        p_bytes: bytes ?? null,
        p_outcome: code,
        p_model: TRANSCRIBE_MODEL,
        p_duration_seconds: null,
      });
    } catch (e) {
      console.error("[wa-voice] finalize failed", e instanceof Error ? e.message : String(e));
    }
  };

  const sid = envGet("TWILIO_ACCOUNT_SID");
  const token = envGet("TWILIO_AUTH_TOKEN");
  const hasAi = !!(envGet("LOVABLE_API_KEY") || envGet("GEMINI_API_KEY"));
  if (!sid || !token || !hasAi) {
    console.error("[wa-voice] missing credentials");
    await finalize("failed", "CREDENTIALS_MISSING");
    return { transcript: null, message: DISABLED_TEXT, code: "CREDENTIALS_MISSING" };
  }

  try {
    const fetched = await fetchTwilioMedia(url, "Basic " + btoa(`${sid}:${token}`), messageSid);
    if (!fetched.ok) {
      await finalize("failed", fetched.reason);
      return { transcript: null, message: UNSUPPORTED_TEXT, code: fetched.reason };
    }
    const response = fetched.response;

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.error("[wa-voice] media fetch failed", response.status);
      await finalize("failed", `MEDIA_${response.status}`);
      return { transcript: null, message: VOICE_FAIL_TEXT, code: "MEDIA_FETCH_FAILED" };
    }

    const serverType = response.headers.get("content-type") || "";
    if (isDisallowedMediaContentType(serverType)) {
      await response.body?.cancel().catch(() => {});
      logRefusal("body", "CONTENT_TYPE_REJECTED", fetched.finalHost, messageSid);
      await finalize("refused", "CONTENT_TYPE_REJECTED");
      return { transcript: null, message: UNSUPPORTED_TEXT, code: "CONTENT_TYPE_REJECTED" };
    }

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      await finalize("refused", "TOO_LARGE", declared);
      return { transcript: null, message: TOO_LONG_TEXT, code: "TOO_LARGE" };
    }

    const bytes = await readCapped(response, maxBytes);
    if (bytes === null) {
      await finalize("refused", "TOO_LARGE");
      return { transcript: null, message: TOO_LONG_TEXT, code: "TOO_LARGE" };
    }
    if (!looksLikeMediaBytes(bytes)) {
      logRefusal("body", "NOT_MEDIA_BODY", fetched.finalHost, messageSid);
      await finalize("refused", "NOT_MEDIA_BODY", bytes.length);
      return { transcript: null, message: UNSUPPORTED_TEXT, code: "NOT_MEDIA_BODY" };
    }
    if (bytes.length < MIN_AUDIO_BYTES) {
      await finalize("refused", "TOO_SHORT", bytes.length);
      return { transcript: null, message: VOICE_FAIL_TEXT, code: "TOO_SHORT" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const r = await chatCompletionWithFallback({
      model: TRANSCRIBE_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You transcribe short WhatsApp voice notes from Nigerian customers ordering food, medicine or groceries. " +
            "Return ONLY the transcription text, no quotes, no commentary, no translation of proper names. " +
            "If there is no intelligible speech, return exactly: NO_SPEECH",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this voice note." },
            {
              type: "input_audio",
              input_audio: { data: toBase64(bytes), format: audioFormat(contentType) },
            },
          ],
        },
      ],
    }, { signal: controller.signal }).finally(() => clearTimeout(timer));

    if (!r.ok) {
      console.error("[wa-voice] AI error", r.status, (r.errorText || "").slice(0, 200));
      await finalize("failed", `AI_${r.status}`, bytes.length);
      return { transcript: null, message: VOICE_FAIL_TEXT, code: "AI_FAILED" };
    }
    const text = String(r.data?.choices?.[0]?.message?.content || "").trim();
    if (!text || /^no_speech$/i.test(text) || text.length < 2) {
      await finalize("done", "NO_SPEECH", bytes.length);
      return { transcript: null, message: VOICE_FAIL_TEXT, code: "NO_SPEECH" };
    }
    await finalize("done", "TRANSCRIBED", bytes.length);
    const reported: any = r.data?.usage ?? null;
    return {
      transcript: text.slice(0, 400),
      message: null,
      code: "TRANSCRIBED",
      modelId: TRANSCRIBE_MODEL,
      usage: reported
        ? {
          inputTokens: reported.prompt_tokens ?? reported.input_tokens ?? null,
          outputTokens: reported.completion_tokens ?? reported.output_tokens ?? null,
        }
        : null,
    };
  } catch (e) {
    console.error("[wa-voice] transcription failed", e instanceof Error ? e.message : String(e));
    await finalize("failed", "EXCEPTION");
    return { transcript: null, message: VOICE_FAIL_TEXT, code: "EXCEPTION" };
  }
}
