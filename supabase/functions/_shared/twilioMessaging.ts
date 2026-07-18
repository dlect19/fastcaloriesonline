import { getWhatsAppFromNumber } from "./whatsapp.ts";

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";

export type TwilioChannel = "whatsapp" | "sms";

export interface TwilioSendResult {
  ok: boolean;
  sid?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  error?: string | null;
  error_code?: number | null;
  error_message?: string | null;
  raw?: unknown;
}

export function normalizeE164Phone(raw: string): string {
  let p = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/[\s\-()]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0") && p.length === 11) return "+234" + p.slice(1);
  if (p.startsWith("234")) return "+" + p;
  return "+" + p.replace(/^\+/, "");
}

export function toLocalNgPhone(e164: string): string {
  const p = normalizeE164Phone(e164);
  return p.startsWith("+234") ? "0" + p.slice(4) : p;
}

function describeTwilioFailure(status?: string | null, code?: number | null, message?: string | null): string {
  if (code === 63016) {
    return "WhatsApp rejected the message because this is a free-form message outside the allowed customer chat window. The customer must first message the business on WhatsApp, or an approved WhatsApp template must be used.";
  }
  if (code === 63024) {
    return "WhatsApp could not deliver to this recipient. The number may not be reachable on WhatsApp from this sender, or the customer has not opted in / started the chat.";
  }
  if (code === 63007) {
    return "The configured WhatsApp sender number is not valid for this Twilio account.";
  }
  if (message) return message;
  if (status === "undelivered" || status === "failed") return `Twilio marked the message as ${status}.`;
  return "Twilio could not deliver the message.";
}

async function parseResponse(r: Response): Promise<any> {
  const text = await r.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { text }; }
}

async function fetchMessageStatus(lovableKey: string, twilioKey: string, sid: string): Promise<any | null> {
  const r = await fetch(`${GATEWAY}/Messages/${sid}.json`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Accept": "application/json",
    },
  });
  const data = await parseResponse(r);
  return r.ok ? data : null;
}

async function pollMessageStatus(lovableKey: string, twilioKey: string, sid: string): Promise<any | null> {
  // WhatsApp delivery failures such as 63016 usually appear a few seconds after Twilio first reports "sent".
  // Do not treat "sent" as final; keep polling briefly so the app doesn't show success for messages Meta later rejects.
  let last: any | null = null;
  for (const ms of [1200, 1800, 2500, 3500]) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const data = await fetchMessageStatus(lovableKey, twilioKey, sid);
    if (!data) continue;
    last = data;
    if (data.error_code || ["read", "delivered", "failed", "undelivered"].includes(data.status)) return data;
  }
  return last;
}

export async function getTwilioMessageStatus(sid: string): Promise<TwilioSendResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  if (!lovableKey || !twilioKey) return { ok: false, error: "twilio_not_configured" };
  if (!sid) return { ok: false, error: "missing_message_sid" };

  const data = await fetchMessageStatus(lovableKey, twilioKey, sid);
  if (!data) return { ok: false, error: "status_lookup_failed" };

  const status = data?.status ?? null;
  const errorCode = data?.error_code ?? null;
  const errorMessage = data?.error_message ?? null;
  const failed = ["failed", "undelivered"].includes(status) || !!errorCode;
  return {
    ok: !failed,
    sid: data?.sid ?? sid,
    status,
    from: data?.from ?? null,
    to: data?.to ?? null,
    error: failed ? describeTwilioFailure(status, errorCode, errorMessage) : null,
    error_code: errorCode,
    error_message: errorMessage,
    raw: data,
  };
}

export async function sendTwilioMessage(
  supabase: any,
  params: {
    channel: TwilioChannel;
    to: string;
    body: string;
    poll?: boolean;
    contentSid?: string;
    contentVariables?: Record<string, string>;
  },
): Promise<TwilioSendResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  if (!lovableKey || !twilioKey) return { ok: false, error: "twilio_not_configured" };

  const normalizedTo = normalizeE164Phone(params.to);
  if (!normalizedTo) return { ok: false, error: "invalid_phone" };

  const from = params.channel === "whatsapp"
    ? await getWhatsAppFromNumber(supabase)
    : Deno.env.get("TWILIO_SMS_FROM");
  if (!from) return { ok: false, error: `${params.channel}_sender_not_configured` };

  const To = params.channel === "whatsapp" ? `whatsapp:${normalizedTo}` : normalizedTo;
  const From = params.channel === "whatsapp"
    ? (from.startsWith("whatsapp:") ? from : `whatsapp:${from}`)
    : from;

  try {
    const form: Record<string, string> = { To, From };
    if (params.contentSid && params.channel === "whatsapp") {
      form.ContentSid = params.contentSid;
      if (params.contentVariables) {
        form.ContentVariables = JSON.stringify(params.contentVariables);
      }
    } else {
      form.Body = params.body;
    }
    const r = await fetch(`${GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
    });
    const data = await parseResponse(r);
    if (!r.ok) {
      return {
        ok: false,
        status: "failed",
        from: From,
        to: To,
        error: describeTwilioFailure("failed", data?.code, data?.message),
        error_code: data?.code ?? null,
        error_message: data?.message ?? null,
        raw: data,
      };
    }

    let final = data;
    if (params.poll !== false && data?.sid) {
      final = await pollMessageStatus(lovableKey, twilioKey, data.sid) || data;
    }

    const status = final?.status ?? data?.status ?? "queued";
    const errorCode = final?.error_code ?? data?.error_code ?? null;
    const errorMessage = final?.error_message ?? data?.error_message ?? null;
    const failed = ["failed", "undelivered"].includes(status) || !!errorCode;

    return {
      ok: !failed,
      sid: data?.sid ?? null,
      status,
      from: From,
      to: To,
      error: failed ? describeTwilioFailure(status, errorCode, errorMessage) : null,
      error_code: errorCode,
      error_message: errorMessage,
      raw: final,
    };
  } catch (e) {
    return { ok: false, from: From, to: To, error: (e as Error).message };
  }
}
