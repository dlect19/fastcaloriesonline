import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Scope = "customer" | "vendor" | "rider" | "delivery_company" | "all";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) throw new Error("Unauthorized");

    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin");
    if (!callerRoles || callerRoles.length === 0) throw new Error("Admin access required");

    const { userId, scope, reason } = (await req.json()) as {
      userId: string;
      scope: Scope;
      reason?: string;
    };
    if (!userId || !scope) throw new Error("Missing userId or scope");
    if (userId === caller.id) throw new Error("You cannot delete your own account");

    // Block deleting other admins for safety
    const { data: targetAdmin } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (targetAdmin) throw new Error("Cannot delete an admin account from this tool");

    const removed: string[] = [];

    const removeVendor = async () => {
      await admin.from("vendors").delete().eq("user_id", userId);
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "vendor");
      removed.push("vendor");
    };
    const removeRider = async () => {
      await admin.from("rider_profiles").delete().eq("user_id", userId);
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "rider");
      removed.push("rider");
    };
    const removeDelivery = async () => {
      await admin.from("delivery_companies").delete().eq("user_id", userId);
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "delivery_company");
      removed.push("delivery_company");
    };
    const removeCustomerRole = async () => {
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "customer");
      removed.push("customer");
    };

    if (scope === "vendor") await removeVendor();
    else if (scope === "rider") await removeRider();
    else if (scope === "delivery_company") await removeDelivery();
    else if (scope === "customer") await removeCustomerRole();
    else if (scope === "all") {
      await removeVendor();
      await removeRider();
      await removeDelivery();
      await removeCustomerRole();
      // Delete auth user (DB FKs cascade for profiles & user-owned rows configured with ON DELETE CASCADE)
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) throw new Error(`Auth delete failed: ${delErr.message}`);
      removed.push("auth_user");
    } else {
      throw new Error("Invalid scope");
    }

    await admin.from("activity_logs").insert({
      user_id: caller.id,
      action: "admin_delete_user",
      entity_type: "user",
      entity_id: userId,
      details: { scope, removed, reason: reason || null },
    });

    return new Response(JSON.stringify({ success: true, removed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("admin-delete-user error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
