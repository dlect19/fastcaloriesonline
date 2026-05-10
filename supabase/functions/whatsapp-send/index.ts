// Outbound WhatsApp sender via Twilio (connector gateway).
// Used by admin actions and (later) order-status triggers.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const SANDBOX_FROM = "whatsapp:+14155238886";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured (link Twilio connector)");

    // Auth: must be admin
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

    const { to, body } = await req.json();
    if (!to || !body) {
      return new Response(JSON.stringify({ error: "to and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const from = Deno.env.get("TWILIO_WHATSAPP_FROM") || SANDBOX_FROM;
    const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

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
      return new Response(JSON.stringify({ error: "twilio_failed", details: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const phone = to.replace("whatsapp:", "");
    const { data: session } = await admin.from("whatsapp_sessions").select("id").eq("phone", phone).maybeSingle();
    await admin.from("whatsapp_messages").insert({
      session_id: session?.id ?? null, phone, direction: "out", body, twilio_sid: data.sid ?? null,
    });

    return new Response(JSON.stringify({ success: true, sid: data.sid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("whatsapp-send error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
