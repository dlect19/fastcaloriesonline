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

const ALLOWED_ROLES = new Set(["vendor", "rider", "delivery_company", "event_organizer"]);
const ALLOWED_ACTIONS = new Set(["grant", "revoke"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);
    const { targetUserId, role, action, stepUpToken, reason } = await req.json();

    if (!targetUserId || typeof targetUserId !== "string") throw new HttpError("targetUserId required", 400);
    if (!ALLOWED_ROLES.has(role)) throw new HttpError("Invalid role", 400);
    if (!ALLOWED_ACTIONS.has(action)) throw new HttpError("Invalid action", 400);

    const stepUpAction = action === "grant" ? "role_grant" : "role_revoke";
    const audit = new AuditTrail(svc, caller, meta);
    const entry = {
      action: `role_${action}`,
      category: "roles" as const,
      targetType: "user",
      targetId: targetUserId,
      newValue: { role, action },
      reason: reason ?? null,
    };

    try {
      await consumeStepUpToken(svc, caller.id, stepUpAction, targetUserId, stepUpToken);
    } catch (e) {
      await audit.failure(entry, e instanceof Error ? e.message : "step-up failed");
      throw e;
    }

    await audit.begin(entry);

    if (action === "grant") {
      const { error } = await svc
        .from("user_roles")
        .upsert({ user_id: targetUserId, role }, { onConflict: "user_id,role" });
      if (error) throw new HttpError(error.message, 500);
    } else {
      const { error } = await svc
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .eq("role", role);
      if (error) throw new HttpError(error.message, 500);
    }

    await audit.success(entry);
    return jsonResponse({ success: true, action, role, targetUserId });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-manage-role error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
