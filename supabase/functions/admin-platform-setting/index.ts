// Hardened writer for protected platform settings (blocked from direct browser writes by DB trigger).
// Requires: active super admin + fresh authenticator step-up + append-only audit record.
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

const PROTECTED_KEYS = new Set(["platform_environment", "admin_role_permissions"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);
    requireSuperAdmin(caller);

    const { key, value, stepUpToken, reason, confirmationText } = await req.json();
    if (!key || typeof key !== "string" || !PROTECTED_KEYS.has(key)) {
      throw new HttpError("Unsupported setting key", 400);
    }
    if (value === undefined || value === null) throw new HttpError("value required", 400);

    const isEnvironment = key === "platform_environment";
    if (isEnvironment && !["development", "production"].includes(String(value))) {
      throw new HttpError("Environment must be development or production", 400);
    }

    const { data: current } = await svc
      .from("platform_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    const audit = new AuditTrail(svc, caller, meta);
    const entry = {
      action: isEnvironment ? "environment_switch" : "platform_setting_write",
      category: "configuration" as const,
      targetType: "platform_setting",
      targetId: key,
      targetLabel: key,
      oldValue: { value: current?.value ?? null },
      newValue: { value },
      environment: isEnvironment ? String(value) : null,
      reason: reason ?? null,
    };

    const stepUpAction = isEnvironment ? "environment_switch" : "platform_setting_write";
    try {
      await consumeStepUpToken(svc, caller.id, stepUpAction, key, stepUpToken);
    } catch (e) {
      await audit.failure(entry, e instanceof Error ? e.message : "step-up failed");
      throw e;
    }
    await audit.begin(entry);

    // Service role bypasses the browser-write guard (auth.uid() is null here).
    const payload = { key, value: value as never, updated_at: new Date().toISOString() };
    const { error } = current
      ? await svc.from("platform_settings").update(payload).eq("key", key)
      : await svc.from("platform_settings").insert(payload);
    if (error) throw new HttpError(error.message, 400);

    if (isEnvironment) {
      await svc.from("environment_switch_logs").insert({
        switched_by: caller.id,
        from_environment: String(current?.value ?? "development"),
        to_environment: String(value),
        confirmation_text: confirmationText ?? "verified via authenticator step-up",
      });
    }

    await audit.success(entry);
    return jsonResponse({ success: true, key, value });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-platform-setting error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
