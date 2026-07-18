// Send a 6-digit OTP to a phone number via WhatsApp, falling back to SMS.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string {
  return normalizeE164Phone(raw);
}

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
    const phone = normalizePhone(String(body.phone || ""));
    const purpose = ["verify", "signup", "login"].includes(body.purpose) ? body.purpose : "verify";
    const preferSms = body.channel === "sms";

    if (!phone || phone.length < 8) {
      return new Response(JSON.stringify({ error: "invalid_phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Rate limit: max 3 sends per 5 min per phone
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await admin.from("phone_verification_otps")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", fiveMinAgo);
    if ((count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "Too many attempts. Try again in a few minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get user id if any (from auth token)
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
    const purposeLabel =
      purpose === "login"
        ? "sign-in"
        : purpose === "signup"
        ? "sign-up"
        : "phone verification";
    const message =
      purpose === "login"
        ? `Your Fast Calories login code is: ${code}\n\nUse this code to sign in to your account. It expires in 10 minutes. Do not share it with anyone.`
        : purpose === "signup"
        ? `Your Fast Calories sign-up code is: ${code}\n\nUse this code to create your new account. It expires in 10 minutes. Do not share it with anyone.`
        : `Your Fast Calories phone verification code is: ${code}\n\nUse this code to verify your phone number. It expires in 10 minutes. Do not share it with anyone.`;

    // Try WhatsApp first (unless caller explicitly asked for SMS). Use approved OTP
    // template so delivery works even outside the 24-hour customer chat window.
    const OTP_CONTENT_SID = Deno.env.get("TWILIO_OTP_CONTENT_SID") || "HXdeeb66b6a153acab9852859f86c7e5b4";
    let channelUsed: "whatsapp" | "sms" = preferSms ? "sms" : "whatsapp";
    let send = await sendTwilioMessage(admin, {
      channel: channelUsed,
      to: phone,
      body: message,
      contentSid: channelUsed === "whatsapp" ? OTP_CONTENT_SID : undefined,
      contentVariables: channelUsed === "whatsapp" ? { "1": code } : undefined,
    });

    // Fallback to SMS if WhatsApp failed and SMS sender exists
    if (!send.ok && channelUsed === "whatsapp" && Deno.env.get("TWILIO_SMS_FROM")) {
      channelUsed = "sms";
      send = await sendTwilioMessage(admin, { channel: "sms", to: phone, body: message });
    }

    if (!send.ok) {
      await logTwilioCall(admin, {
        user_id: userId, initiated_by: userId, channel: channelUsed,
        to_phone: phone, from_phone: send.from?.replace("whatsapp:", "") ?? null,
        body: message, function_name: "send-phone-otp",
        twilio_sid: send.sid ?? null, twilio_status: send.status ?? "failed",
        error: String(send.error || send.error_code || "send_failed").slice(0, 500),
      });
      return new Response(JSON.stringify({ error: "send_failed", details: send.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logTwilioCall(admin, {
      user_id: userId, initiated_by: userId, channel: channelUsed,
      to_phone: phone, from_phone: send.from?.replace("whatsapp:", "") ?? null,
      body: message, twilio_sid: send.sid ?? null,
      twilio_status: send.status ?? "queued", function_name: "send-phone-otp",
    });

    await admin.from("phone_verification_otps").insert({
      user_id: userId, phone, code_hash: codeHash, channel: channelUsed,
      purpose, expires_at: expiresAt,
    });

    return new Response(JSON.stringify({
      success: true, channel: channelUsed, expires_at: expiresAt,
      fell_back: preferSms ? false : channelUsed === "sms",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("send-phone-otp error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
