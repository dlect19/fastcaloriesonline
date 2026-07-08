// Shared helper: estimate cost of a Twilio send in Naira and log it to twilio_api_logs.
// Defaults are conservative estimates — tune via platform_settings if needed.

const DEFAULT_WHATSAPP_NGN = 25;   // per message
const DEFAULT_SMS_NGN_PER_SEG = 20; // per 160-char segment

export function estimateSegments(body: string, channel: "whatsapp" | "sms"): number {
  if (channel === "whatsapp") return 1;
  const len = (body || "").length;
  if (len === 0) return 1;
  // GSM-7 concatenation: 153 chars/segment after the first. Simplified.
  return Math.max(1, Math.ceil(len / 153));
}

export function estimatePriceNgn(body: string, channel: "whatsapp" | "sms"): number {
  const segs = estimateSegments(body, channel);
  return channel === "whatsapp"
    ? DEFAULT_WHATSAPP_NGN
    : DEFAULT_SMS_NGN_PER_SEG * segs;
}

export interface LogTwilioParams {
  user_id?: string | null;
  initiated_by?: string | null;
  channel: "whatsapp" | "sms";
  to_phone?: string | null;
  from_phone?: string | null;
  body?: string | null;
  twilio_sid?: string | null;
  twilio_status?: string | null;
  function_name: string;
  error?: string | null;
  direction?: "in" | "out";
  order_id?: string | null;
}

export async function logTwilioCall(supabase: any, p: LogTwilioParams) {
  try {
    const body = p.body || "";
    const segments = estimateSegments(body, p.channel);
    const price = p.error ? 0 : estimatePriceNgn(body, p.channel);
    await supabase.from("twilio_api_logs").insert({
      user_id: p.user_id ?? null,
      initiated_by: p.initiated_by ?? null,
      direction: p.direction ?? "out",
      channel: p.channel,
      to_phone: p.to_phone ?? null,
      from_phone: p.from_phone ?? null,
      body_preview: body.slice(0, 200),
      twilio_sid: p.twilio_sid ?? null,
      twilio_status: p.twilio_status ?? null,
      segments,
      price_ngn: price,
      function_name: p.function_name,
      error: p.error ?? null,
    });
  } catch (e) {
    console.error("logTwilioCall failed:", e);
  }
}
