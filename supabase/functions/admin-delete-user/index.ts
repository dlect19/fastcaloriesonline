import {
  authenticateAdmin,
  AuditTrail,
  consumeStepUpToken,
  corsHeaders,
  HttpError,
  jsonResponse,
  requestMeta,
  serviceClient,
} from "../_shared/adminGuard.ts";

type Scope = "customer" | "vendor" | "rider" | "delivery_company" | "all";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);

    const { userId, scope, reason, stepUpToken } = (await req.json()) as {
      userId: string;
      scope: Scope;
      reason?: string;
      stepUpToken?: string;
    };
    if (!userId || !scope) throw new HttpError("Missing userId or scope", 400);
    if (userId === caller.id) throw new HttpError("You cannot delete your own account", 400);

    // Never allow deleting admins / the protected root super admin from this tool
    const [{ data: targetAdminRole }, { data: targetStaff }] = await Promise.all([
      svc.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      svc.from("admin_staff").select("id, role, is_protected").eq("user_id", userId).maybeSingle(),
    ]);
    if (targetStaff?.is_protected) throw new HttpError("The protected root super admin cannot be deleted", 403);
    if (targetAdminRole || targetStaff) {
      throw new HttpError("Admin accounts must be removed from Admin Staff management", 403);
    }

    const audit = new AuditTrail(svc, caller, meta);
    const entry = {
      action: "user_delete",
      category: "credentials" as const,
      targetType: "user",
      targetId: userId,
      newValue: { scope },
      reason: reason ?? null,
    };

    try {
      await consumeStepUpToken(svc, caller.id, "user_delete", userId, stepUpToken);
    } catch (e) {
      await audit.failure(entry, e instanceof Error ? e.message : "step-up failed");
      throw e;
    }
    await audit.begin(entry);

    const removed: string[] = [];

    const removeVendor = async () => {
      await svc.from("vendors").delete().eq("user_id", userId);
      await svc.from("user_roles").delete().eq("user_id", userId).eq("role", "vendor");
      removed.push("vendor");
    };
    const removeRider = async () => {
      await svc.from("rider_profiles").delete().eq("user_id", userId);
      await svc.from("user_roles").delete().eq("user_id", userId).eq("role", "rider");
      removed.push("rider");
    };
    const removeDelivery = async () => {
      await svc.from("delivery_companies").delete().eq("user_id", userId);
      await svc.from("user_roles").delete().eq("user_id", userId).eq("role", "delivery_company");
      removed.push("delivery_company");
    };
    const removeCustomerRole = async () => {
      await svc.from("user_roles").delete().eq("user_id", userId).eq("role", "customer");
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
      const { error: delErr } = await svc.auth.admin.deleteUser(userId);
      if (delErr) throw new HttpError(`Auth delete failed: ${delErr.message}`, 400);
      removed.push("auth_user");
    } else {
      throw new HttpError("Invalid scope", 400);
    }

    await audit.success({ ...entry, newValue: { scope, removed } });

    await svc.from("activity_logs").insert({
      user_id: caller.id,
      action: "admin_delete_user",
      entity_type: "user",
      entity_id: userId,
      details: { scope, removed, reason: reason || null },
    });

    return jsonResponse({ success: true, removed });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-delete-user error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
