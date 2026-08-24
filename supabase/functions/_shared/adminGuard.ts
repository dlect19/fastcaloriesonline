// Shared hardened authorization / step-up / audit helpers for privileged admin actions.
// NEVER log or persist plaintext TOTP codes, secrets, passwords or JWTs here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as OTPAuth from "npm:otpauth@9.3.2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// deno-lint-ignore no-explicit-any
export type Svc = any;

export function serviceClient(): Svc {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

export interface Caller {
  id: string;
  email: string | null;
  name: string | null;
  staffRole: string | null;
  isSuperAdmin: boolean;
  isProtectedRoot: boolean;
  hasAdminRole: boolean;
}

/** Authenticate the caller from their JWT (never trust ids in the request body). */
export async function authenticateAdmin(req: Request, svc: Svc): Promise<Caller> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new HttpError("Unauthorized", 401);
  const token = authHeader.replace("Bearer ", "");
  if (token === SERVICE_KEY) throw new HttpError("Service key cannot be used as a caller", 401);

  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) throw new HttpError("Invalid or expired session", 401);
  const user = data.user;

  const [{ data: roles }, { data: staff }, { data: profile }] = await Promise.all([
    svc.from("user_roles").select("role").eq("user_id", user.id),
    svc
      .from("admin_staff")
      .select("role, is_active, is_protected")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    svc.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
  ]);

  // deno-lint-ignore no-explicit-any
  const hasAdminRole = !!roles?.some((r: any) => r.role === "admin");
  if (!hasAdminRole && !staff) throw new HttpError("Admin access required", 403);

  return {
    id: user.id,
    email: user.email ?? null,
    name: profile?.full_name ?? null,
    staffRole: staff?.role ?? (hasAdminRole ? "admin" : null),
    isSuperAdmin: staff?.role === "super_admin",
    isProtectedRoot: !!staff?.is_protected,
    hasAdminRole,
  };
}

export function requireSuperAdmin(caller: Caller) {
  if (!caller.isSuperAdmin) {
    throw new HttpError("Active super admin access required for this action", 403);
  }
}

/**
 * Validate a fresh authenticator (TOTP) code for the given admin.
 * Includes replay protection: a code can only be used once per admin.
 */
export async function verifyTotpCode(svc: Svc, userId: string, code: unknown): Promise<void> {
  const clean = String(code ?? "").replace(/\D/g, "");
  if (clean.length !== 6) throw new HttpError("Enter the 6-digit code from your authenticator app", 400);

  const { data: settings } = await svc
    .from("admin_2fa_settings")
    .select("totp_secret, totp_enabled, last_totp_counter")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.totp_enabled || !settings.totp_secret) {
    throw new HttpError(
      "Authenticator app not enrolled. Enroll at /admin/security before performing sensitive actions.",
      428,
    );
  }

  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(settings.totp_secret),
    digits: 6,
    period: 30,
  });
  const delta = totp.validate({ token: clean, window: 1 });
  if (delta === null) throw new HttpError("Invalid authenticator code", 401);

  const counter = Math.floor(Date.now() / 30000) + delta;
  if (settings.last_totp_counter !== null && Number(settings.last_totp_counter) >= counter) {
    throw new HttpError("That authenticator code was already used. Wait for the next code.", 401);
  }
  await svc.from("admin_2fa_settings").update({ last_totp_counter: counter }).eq("user_id", userId);
}

/** Issue an opaque, short-lived, single-use step-up token bound to actor + action + target. */
export async function issueStepUpToken(
  svc: Svc,
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  meta: RequestMeta,
  ttlSeconds = 180,
): Promise<{ token: string; expiresAt: string }> {
  const raw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await svc.from("admin_step_up_tokens").insert({
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId,
    token_hash: await sha256Hex(raw),
    expires_at: expiresAt,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  });
  if (error) throw new HttpError(`Could not issue verification token: ${error.message}`, 500);
  return { token: raw, expiresAt };
}

/** Consume a step-up token; throws unless it matches actor + action (+ target) and is unused/unexpired. */
export async function consumeStepUpToken(
  svc: Svc,
  actorId: string,
  action: string,
  targetId: string | null,
  token: unknown,
): Promise<void> {
  const raw = typeof token === "string" ? token : "";
  if (raw.length < 20) throw new HttpError("Authenticator verification required for this action", 401);
  const hash = await sha256Hex(raw);

  const { data, error } = await svc
    .from("admin_step_up_tokens")
    .select("id, target_id, expires_at, consumed_at")
    .eq("token_hash", hash)
    .eq("actor_id", actorId)
    .eq("action", action)
    .maybeSingle();

  if (error) throw new HttpError(`Verification lookup failed: ${error.message}`, 500);
  if (!data || data.consumed_at || new Date(data.expires_at).getTime() < Date.now()) {
    throw new HttpError("Authenticator verification invalid, expired, or already used", 401);
  }
  if (data.target_id && targetId && data.target_id !== targetId) {
    throw new HttpError("Verification was issued for a different target", 401);
  }

  const { data: consumed, error: cErr } = await svc
    .from("admin_step_up_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (cErr || !consumed) throw new HttpError("Authenticator verification already used", 401);
}

export interface AuditEntry {
  action: string;
  category: "security" | "financial" | "roles" | "credentials" | "configuration";
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  amount?: number | null;
  environment?: string | null;
  reference?: string | null;
  reason?: string | null;
}

export class AuditTrail {
  correlationId = crypto.randomUUID();
  constructor(
    private svc: Svc,
    private caller: Caller,
    private meta: RequestMeta,
    private authMethod = "totp_step_up",
  ) {}

  private row(entry: AuditEntry, outcome: string, errorMessage?: string) {
    return {
      correlation_id: this.correlationId,
      actor_id: this.caller.id,
      actor_role: this.caller.staffRole,
      actor_email: this.caller.email,
      actor_name: this.caller.name,
      action: entry.action,
      category: entry.category,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      amount: entry.amount ?? null,
      environment: entry.environment ?? null,
      reference: entry.reference ?? null,
      reason: entry.reason ?? null,
      ip_address: this.meta.ip,
      user_agent: this.meta.userAgent,
      outcome,
      error_message: errorMessage ?? null,
      auth_method: this.authMethod,
    };
  }

  /** Mandatory pre-write: if the audit record cannot be stored, the action must not run. */
  async begin(entry: AuditEntry) {
    const { error } = await this.svc.from("admin_sensitive_audit").insert(this.row(entry, "pending"));
    if (error) throw new HttpError(`Audit trail unavailable, action aborted: ${error.message}`, 500);
  }

  async success(entry: AuditEntry) {
    const { error } = await this.svc.from("admin_sensitive_audit").insert(this.row(entry, "success"));
    if (error) throw new HttpError(`Audit trail write failed: ${error.message}`, 500);
  }

  async failure(entry: AuditEntry, message: string) {
    await this.svc.from("admin_sensitive_audit").insert(this.row(entry, "failed", message.slice(0, 500)));
  }
}
