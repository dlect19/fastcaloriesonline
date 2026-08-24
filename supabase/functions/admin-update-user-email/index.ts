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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);
    const { userId, newEmail, stepUpToken, reason } = await req.json();
    if (!userId || !newEmail) throw new HttpError("Missing userId or newEmail", 400);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(newEmail))) throw new HttpError("Invalid email format", 400);

    const { data: staff } = await svc
      .from("admin_staff")
      .select("is_protected, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (staff?.is_protected && !caller.isProtectedRoot) {
      throw new HttpError("Only the root super admin can change its own login email", 403);
    }
    if (staff && !caller.isSuperAdmin) {
      throw new HttpError("Only super admins can change an admin staff login email", 403);
    }

    const { data: existing } = await svc.auth.admin.getUserById(userId);

    const audit = new AuditTrail(svc, caller, meta);
    const entry = {
      action: "user_email_change",
      category: "credentials" as const,
      targetType: "user",
      targetId: userId,
      oldValue: { email: existing?.user?.email ?? null },
      newValue: { email: newEmail },
      reason: reason ?? null,
    };

    try {
      await consumeStepUpToken(svc, caller.id, "user_email_change", userId, stepUpToken);
    } catch (e) {
      await audit.failure(entry, e instanceof Error ? e.message : "step-up failed");
      throw e;
    }
    await audit.begin(entry);

    const { error } = await svc.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    });
    if (error) throw new HttpError(error.message, 400);

    await audit.success(entry);

    await svc.from("activity_logs").insert({
      user_id: caller.id,
      action: "admin_update_email",
      entity_type: "user",
      entity_id: userId,
      details: { new_email: newEmail },
    });

    return jsonResponse({ success: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-update-user-email error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
