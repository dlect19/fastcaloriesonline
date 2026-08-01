// WhatsApp voice-note support (modular — voice replies can be added later).
// Downloads the Twilio audio media, transcribes it with the existing Gemini
// integration (Lovable AI Gateway), and returns plain text that is fed into the
// SAME conversation pipeline used for typed messages.

const AUDIO_MIME_PREFIX = "audio/";

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

/**
 * Transcribe a WhatsApp voice note to text. Returns null when the audio can't
 * be downloaded or transcribed — caller should ask the customer to retype.
 */
export async function transcribeVoiceNote(url: string, contentType: string): Promise<string | null> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!sid || !token || !apiKey) {
    console.error("[wa-voice] missing credentials");
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: "Basic " + btoa(`${sid}:${token}`) },
      redirect: "follow",
    });
    if (!res.ok) {
      console.error("[wa-voice] media fetch failed", res.status);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Guard: empty / near-empty recording, and cap oversized uploads (~8 MB).
    if (bytes.length < 1024 || bytes.length > 8 * 1024 * 1024) {
      console.error("[wa-voice] audio size out of range", bytes.length);
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
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
      }),
    }).finally(() => clearTimeout(timer));

    if (!r.ok) {
      console.error("[wa-voice] gateway error", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content || "").trim();
    if (!text || /^no_speech$/i.test(text) || text.length < 2) return null;
    console.log("[wa-voice] transcribed", text.slice(0, 120));
    return text.slice(0, 400);
  } catch (e) {
    console.error("[wa-voice] transcription failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export const VOICE_FAIL_TEXT =
  "🎙️ I couldn't quite hear that voice note. Please record it again in a quieter spot, or just type your message — e.g. *I want 2 jollof rice*. Reply *menu* anytime for the full menu.";
