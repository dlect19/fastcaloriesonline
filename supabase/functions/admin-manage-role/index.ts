import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = new Set(["vendor", "rider", "delivery_company"]);
const ALLOWED_ACTIONS = new Set(["grant", "revoke"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // Require admin role
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    if (!roles?.some((r: any) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const { targetUserId, role, action } = await req.json();
    if (!targetUserId || typeof targetUserId !== "string") return json({ error: "targetUserId required" }, 400);
    if (!ALLOWED_ROLES.has(role)) return json({ error: "Invalid role. Allowed: vendor, rider, delivery_company" }, 400);
    if (!ALLOWED_ACTIONS.has(action)) return json({ error: "Invalid action. Allowed: grant, revoke" }, 400);

    if (action === "grant") {
      const { error } = await admin
        .from("user_roles")
        .upsert({ user_id: targetUserId, role }, { onConflict: "user_id,role" });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .eq("role", role);
      if (error) return json({ error: error.message }, 500);
    }

    // Best-effort audit log
    try {
      await admin.from("activity_logs").insert({
        user_id: user.id,
        action: `admin_role_${action}`,
        entity_type: "user_role",
        entity_id: targetUserId,
        metadata: { role, action, target_user_id: targetUserId } as any,
      } as any);
    } catch (_) { /* activity_logs may have different columns; skip if it fails */ }

    return json({ success: true, action, role, targetUserId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-manage-role error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
