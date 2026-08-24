// Hardened admin staff mutations: activate/deactivate, change role, remove.
// Requires: active super admin + fresh authenticator step-up + append-only audit record.
// Direct browser writes to admin_staff are blocked by RLS.
import {
  authenticateAdmin,
  AuditTrail,
  consumeStepUpToken,
  corsHeaders,
  HttpError,
  jsonResponse,
  requestMeta,
  requireSuperAdmin,
  serviceClient,
} from "../_shared/adminGuard.ts";

const ROLES = new Set(["super_admin", "admin", "support", "analyst"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);
    requireSuperAdmin(caller);

    const { staffId, action, role, isActive, stepUpToken, reason } = await req.json();
    if (!staffId || typeof staffId !== "string") throw new HttpError("staffId required", 400);
    if (!["update_role", "set_active", "remove"].includes(action)) throw new HttpError("Invalid action", 400);

    const { data: staff } = await svc
      .from("admin_staff")
      .select("id, user_id, role, is_active, is_protected, invite_email")
      .eq("id", staffId)
      .maybeSingle();
    if (!staff) throw new HttpError("Staff member not found", 404);
    if (staff.is_protected) {
      throw new HttpError("The protected root super admin cannot be modified", 403);
    }
    if (staff.user_id === caller.id && action !== "update_role") {
      throw new HttpError("You cannot deactivate or remove your own admin account", 400);
    }

    const stepUpAction = action === "remove" ? "staff_delete" : "staff_update";
    const audit = new AuditTrail(svc, caller, meta);
    const entry = {
      action: `admin_staff_${action}`,
      category: "credentials" as const,
      targetType: "admin_staff",
      targetId: staffId,
      targetLabel: staff.invite_email,
      oldValue: { role: staff.role, is_active: staff.is_active },
      newValue: action === "update_role"
        ? { role }
        : action === "set_active"
        ? { is_active: !!isActive }
        : { removed: true },
      reason: reason ?? null,
    };

    try {
      await consumeStepUpToken(svc, caller.id, stepUpAction, staffId, stepUpToken);
    } catch (e) {
      await audit.failure(entry, e instanceof Error ? e.message : "step-up failed");
      throw e;
    }
    await audit.begin(entry);

    if (action === "update_role") {
      if (!ROLES.has(role)) throw new HttpError("Invalid role", 400);
      const { error } = await svc.from("admin_staff").update({ role }).eq("id", staffId);
      if (error) throw new HttpError(error.message, 400);
    } else if (action === "set_active") {
      const { error } = await svc.from("admin_staff").update({ is_active: !!isActive }).eq("id", staffId);
      if (error) throw new HttpError(error.message, 400);
      if (!isActive) {
        // Revoke platform admin access and any live 2FA sessions
        await svc.from("user_roles").delete().eq("user_id", staff.user_id).eq("role", "admin");
        await svc.from("admin_2fa_sessions").delete().eq("user_id", staff.user_id);
      } else {
        await svc
          .from("user_roles")
          .upsert({ user_id: staff.user_id, role: "admin" }, { onConflict: "user_id,role" });
      }
    } else {
      const { error } = await svc.from("admin_staff").delete().eq("id", staffId);
      if (error) throw new HttpError(error.message, 400);
      await svc.from("user_roles").delete().eq("user_id", staff.user_id).eq("role", "admin");
      await svc.from("admin_2fa_sessions").delete().eq("user_id", staff.user_id);
    }

    await audit.success(entry);
    return jsonResponse({ success: true, action, staffId });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-staff-manage error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
