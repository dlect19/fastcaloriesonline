import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTwilioMessageStatus } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userResult } = await admin.auth.getUser(token);
    const user = userResult.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const rangeDays = Math.min(30, Math.max(1, Number(body.rangeDays || 7)));
    const since = new Date(Date.now() - rangeDays * 86400_000).toISOString();

    const { data: rows, error } = await admin
      .from("twilio_api_logs")
      .select("id, twilio_sid, twilio_status")
      .not("twilio_sid", "is", null)
      .in("twilio_status", ["queued", "accepted", "sending", "sent"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    let checked = 0;
    let updated = 0;
    let failed = 0;

    for (const row of rows || []) {
      checked++;
      const status = await getTwilioMessageStatus(row.twilio_sid as string);
      if (!status.status && !status.error) continue;

      const nextStatus = status.status || row.twilio_status || "unknown";
      const nextError = status.ok ? null : String(status.error || status.error_code || "send_failed").slice(0, 500);
      const { error: updateError } = await admin
        .from("twilio_api_logs")
        .update({ twilio_status: nextStatus, error: nextError })
        .eq("id", row.id);
      if (updateError) throw updateError;

      updated++;
      if (!status.ok) failed++;
    }

    return json({ ok: true, checked, updated, failed });
  } catch (e) {
    console.error("refresh-twilio-statuses error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});