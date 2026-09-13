// Send a 6-digit OTP to a phone number.
//
// WhatsApp OTPs go out ONLY through an approved WhatsApp authentication
// template. Meta rejects free-form messages sent outside the 24-hour
// customer-service window (Twilio 63016), so a free-form WhatsApp OTP is never
// attempted. Without an approved template we use SMS, and without an SMS sender
// we return a clear configuration error. The OTP row is stored only after a
// successful send, and the code itself is never logged.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";
import { describeUnusableChannel, OTP_BODY_REDACTED, planOtpDelivery } from "./otpChannel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const phone = normalizeE164Phone(String(body.phone || ""));
    const purpose = ["verify", "signup", "login"].includes(body.purpose) ? body.purpose : "verify";
    const preferSms = body.channel === "sms";

    if (!phone || phone.length < 8) return json({ error: "invalid_phone" }, 400);

    // Rate limit: max 3 sends per 5 min per phone.
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await admin.from("phone_verification_otps")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", fiveMinAgo);
    if ((count ?? 0) >= 3) {
      return json({ error: "rate_limited", message: "Too many attempts. Try again in a few minutes." }, 429);
    }

    // Identify the caller when signed in (optional).
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const sup = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } });
        const { data } = await sup.auth.getUser();
        userId = data.user?.id ?? null;
      } catch (_) { /* ignore */ }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await sha256Hex(code + phone);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const message =
      purpose === "login"
        ? `Your Fast Calories login code is: ${code}\n\nUse this code to sign in to your account. It expires in 10 minutes. Do not share it with anyone.`
        : purpose === "signup"
        ? `Your Fast Calories sign-up code is: ${code}\n\nUse this code to create your new account. It expires in 10 minutes. Do not share it with anyone.`
        : `Your Fast Calories phone verification code is: ${code}\n\nUse this code to verify your phone number. It expires in 10 minutes. Do not share it with anyone.`;

    const { data: otpTpl } = await admin
      .from("whatsapp_templates")
      .select("content_sid, approval_status")
      .eq("template_key", "wa_otp_code")
      .maybeSingle();

    const smsFrom = Deno.env.get("TWILIO_SMS_FROM") || "";
    const plan = planOtpDelivery({
      preferSms,
      templateSid: otpTpl?.content_sid ?? null,
      templateStatus: otpTpl?.approval_status ?? null,
      envSid: Deno.env.get("TWILIO_OTP_CONTENT_SID") ?? null,
      smsFrom,
    });

    console.log("[send-phone-otp] delivery plan", JSON.stringify({
      purpose,
      channel: plan.channel,
      reason: plan.reason,
      template_key: "wa_otp_code",
      template_status: otpTpl?.approval_status ?? null,
      content_sid: plan.contentSid,
      sms_configured: !!smsFrom,
    }));

    if (!plan.channel) {
      return json({
        error: "otp_channel_unavailable",
        reason: plan.reason,
        message: describeUnusableChannel(plan.reason),
        details: describeUnusableChannel(plan.reason),
      }, 503);
    }

    let channelUsed = plan.channel;
    let fellBack = plan.fellBack;
    let send = await sendTwilioMessage(admin, {
      channel: channelUsed,
      to: phone,
      body: message,
      contentSid: plan.contentSid ?? undefined,
      contentVariables: plan.contentSid ? { "1": code } : undefined,
    });
    console.log("[send-phone-otp] twilio result", JSON.stringify({
      channel: channelUsed, ok: send.ok, sid: send.sid, status: send.status,
      from: send.from, error: send.error, error_code: send.error_code,
    }));

    // Transient/permanent WhatsApp failure → SMS when a sender exists.
    if (!send.ok && channelUsed === "whatsapp" && smsFrom) {
      channelUsed = "sms";
      fellBack = true;
      send = await sendTwilioMessage(admin, { channel: "sms", to: phone, body: message });
      console.log("[send-phone-otp] sms fallback result", JSON.stringify({
        ok: send.ok, sid: send.sid, status: send.status, error: send.error, error_code: send.error_code,
      }));
    }

    // Cost/audit log never carries the code itself.
    await logTwilioCall(admin, {
      user_id: userId, initiated_by: userId, channel: channelUsed,
      to_phone: phone, from_phone: send.from?.replace("whatsapp:", "") ?? null,
      body: OTP_BODY_REDACTED, twilio_sid: send.sid ?? null,
      twilio_status: send.status ?? (send.ok ? "queued" : "failed"),
      function_name: "send-phone-otp",
      error: send.ok ? null : String(send.error || send.error_code || "send_failed").slice(0, 500),
    });

    if (!send.ok) {
      return json({ error: "send_failed", reason: plan.reason, details: send.error }, 502);
    }

    // Only persist the pending code once delivery was accepted.
    await admin.from("phone_verification_otps").insert({
      user_id: userId, phone, code_hash: codeHash, channel: channelUsed,
      purpose, expires_at: expiresAt,
    });

    return json({
      success: true,
      channel: channelUsed,
      fell_back: fellBack,
      reason: plan.reason,
      expires_at: expiresAt,
    });
  } catch (e) {
    console.error("send-phone-otp error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
