// Outbound WhatsApp sender via Twilio (connector gateway).
// Used by admin actions and (later) order-status triggers.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";
import { logTwilioCall } from "../_shared/twilioCost.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured (link Twilio connector)");

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

    const from = await getWhatsAppFromNumber(admin);
    const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const phone = to.replace("whatsapp:", "");

    // Resolve target user_id from phone if not supplied
    let resolvedUserId: string | null = targetUserId ?? null;
    if (!resolvedUserId) {
      const { data: prof } = await admin.from("profiles").select("user_id").eq("phone", phone).maybeSingle();
      resolvedUserId = prof?.user_id ?? null;
    }

    const r = await fetch(`${GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toFormatted, From: from, Body: body }),
    });
    const data = await r.json();

    if (!r.ok) {
      await logTwilioCall(admin, {
        user_id: resolvedUserId, initiated_by: initiatedBy, channel: "whatsapp",
        to_phone: phone, from_phone: from.replace("whatsapp:", ""), body,
        twilio_sid: null, twilio_status: "failed",
        function_name: "whatsapp-send", error: JSON.stringify(data).slice(0, 500),
        order_id: orderId ?? null,
      });
      return new Response(JSON.stringify({ error: "twilio_failed", details: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log to whatsapp_messages (existing) + twilio_api_logs (new)
    const { data: session } = await admin.from("whatsapp_sessions").select("id").eq("phone", phone).maybeSingle();
    await admin.from("whatsapp_messages").insert({
      session_id: session?.id ?? null, phone, direction: "out", body, twilio_sid: data.sid ?? null,
    });
    await logTwilioCall(admin, {
      user_id: resolvedUserId, initiated_by: initiatedBy, channel: "whatsapp",
      to_phone: phone, from_phone: from.replace("whatsapp:", ""), body,
      twilio_sid: data.sid ?? null, twilio_status: data.status ?? "queued",
      function_name: "whatsapp-send",
      order_id: orderId ?? null,
    });

    return new Response(JSON.stringify({ success: true, sid: data.sid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("whatsapp-send error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
