// Verifies a FRESH authenticator (TOTP) code and issues a short-lived, single-use
// step-up token bound to { actor, action, target }. Required before any sensitive admin action.
import {
  authenticateAdmin,
  corsHeaders,
  HttpError,
  issueStepUpToken,
  jsonResponse,
  requestMeta,
  serviceClient,
} from "../_shared/adminGuard.ts";
import { verifyTotpCode } from "../_shared/adminGuard.ts";

const ALLOWED_ACTIONS = new Set([
  // financial
  "wallet_credit",
  "wallet_debit",
  "payout_process",
  "financial_reset",
  "payment_hold_resolve",
  // roles & accounts
  "role_grant",
  "role_revoke",
  "staff_create",
  "staff_update",
  "staff_delete",
  "user_delete",
  "user_email_change",
  // platform security / configuration
  "platform_setting_write",
  "environment_switch",
  "security_setting_write",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  try {
    const caller = await authenticateAdmin(req, svc);
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "status" ? "status" : "verify";

    if (mode === "status") {
      const { data } = await svc
        .from("admin_2fa_settings")
        .select("totp_enabled")
        .eq("user_id", caller.id)
        .maybeSingle();
      return jsonResponse({
        enrolled: !!data?.totp_enabled,
        staffRole: caller.staffRole,
        isSuperAdmin: caller.isSuperAdmin,
      });
    }

    const action = String(body?.action ?? "");
    if (!ALLOWED_ACTIONS.has(action)) throw new HttpError("Unknown sensitive action", 400);

    const targetType = body?.targetType ? String(body.targetType) : null;
    const targetId = body?.targetId ? String(body.targetId) : null;

    await verifyTotpCode(svc, caller.id, body?.code);

    const meta = requestMeta(req);
    const { token, expiresAt } = await issueStepUpToken(svc, caller.id, action, targetType, targetId, meta);

    await svc.from("admin_sensitive_audit").insert({
      actor_id: caller.id,
      actor_role: caller.staffRole,
      actor_email: caller.email,
      actor_name: caller.name,
      action: "step_up_verified",
      category: "security",
      target_type: targetType,
      target_id: targetId,
      new_value: { for_action: action },
      ip_address: meta.ip,
      user_agent: meta.userAgent,
      outcome: "success",
      auth_method: "totp",
    });

    return jsonResponse({ token, expiresAt });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("admin-step-up error:", message);
    return jsonResponse({ error: message }, status);
  }
});
