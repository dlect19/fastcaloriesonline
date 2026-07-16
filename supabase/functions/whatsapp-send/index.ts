// Outbound WhatsApp sender via Twilio (connector gateway).
// Used by admin actions and (later) order-status triggers.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Auth: must be admin (any signed-in user allowed here, callers gate via UI)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const initiatedBy = claims.claims.sub as string;

    const { to, body, user_id: targetUserId, order_id: orderId } = await req.json();
    if (!to || !body) {
      return new Response(JSON.stringify({ error: "to and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const phone = normalizeE164Phone(to);

    // Resolve target user_id from phone if not supplied
    let resolvedUserId: string | null = targetUserId ?? null;
    if (!resolvedUserId) {
      const localPhone = phone.startsWith("+234") ? "0" + phone.slice(4) : phone;
      const { data: prof } = await admin.from("profiles").select("user_id").or(`phone.eq.${phone},phone.eq.${localPhone}`).maybeSingle();
      resolvedUserId = prof?.user_id ?? null;
    }

    const send = await sendTwilioMessage(admin, { channel: "whatsapp", to: phone, body });

    if (!send.ok) {
      await logTwilioCall(admin, {
        user_id: resolvedUserId, initiated_by: initiatedBy, channel: "whatsapp",
        to_phone: phone, from_phone: send.from?.replace("whatsapp:", "") ?? null, body,
        twilio_sid: send.sid ?? null, twilio_status: send.status ?? "failed",
        function_name: "whatsapp-send", error: String(send.error || send.error_code || "send_failed").slice(0, 500),
        order_id: orderId ?? null,
      });
      return new Response(JSON.stringify({ error: "twilio_failed", details: send.error, status: send.status, code: send.error_code }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log to whatsapp_messages (existing) + twilio_api_logs (new)
    const { data: session } = await admin.from("whatsapp_sessions").select("id").eq("phone", phone).maybeSingle();
    await admin.from("whatsapp_messages").insert({
      session_id: session?.id ?? null, phone, direction: "out", body, twilio_sid: send.sid ?? null,
    });
    await logTwilioCall(admin, {
      user_id: resolvedUserId, initiated_by: initiatedBy, channel: "whatsapp",
      to_phone: phone, from_phone: send.from?.replace("whatsapp:", "") ?? null, body,
      twilio_sid: send.sid ?? null, twilio_status: send.status ?? "queued",
      function_name: "whatsapp-send",
      order_id: orderId ?? null,
    });

    return new Response(JSON.stringify({ success: true, sid: send.sid, status: send.status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("whatsapp-send error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
