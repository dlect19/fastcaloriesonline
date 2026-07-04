// Send a 6-digit OTP to a phone number via WhatsApp, falling back to SMS.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const SANDBOX_WA_FROM = "whatsapp:+14155238886";

function normalizePhone(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\s|-/g, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return "+" + trimmed.slice(2);
  if (trimmed.startsWith("0")) return "+234" + trimmed.slice(1); // Nigeria default
  return "+" + trimmed;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendTwilio(kind: "whatsapp" | "sms", to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY) return { ok: false, error: "twilio_not_configured" };

  const from = kind === "whatsapp"
    ? (Deno.env.get("TWILIO_WHATSAPP_FROM") || SANDBOX_WA_FROM)
    : Deno.env.get("TWILIO_SMS_FROM");
  if (!from) return { ok: false, error: `${kind}_sender_not_configured` };

  const To = kind === "whatsapp" ? (to.startsWith("whatsapp:") ? to : `whatsapp:${to}`) : to;
  const From = kind === "whatsapp" ? (from.startsWith("whatsapp:") ? from : `whatsapp:${from}`) : from;

  try {
    const r = await fetch(`${GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To, From, Body: body }),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, sid: data.sid };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
    const message = `Your Fast Calories verification code is: ${code}\n\nIt expires in 10 minutes. Do not share this code with anyone.`;

    // Try WhatsApp first (unless caller explicitly asked for SMS)
    let channelUsed: "whatsapp" | "sms" = preferSms ? "sms" : "whatsapp";
    let send = await sendTwilio(channelUsed, phone, message);

    // Fallback to SMS if WhatsApp failed and SMS sender exists
    if (!send.ok && channelUsed === "whatsapp" && Deno.env.get("TWILIO_SMS_FROM")) {
      channelUsed = "sms";
      send = await sendTwilio("sms", phone, message);
    }

    if (!send.ok) {
      return new Response(JSON.stringify({ error: "send_failed", details: send.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
