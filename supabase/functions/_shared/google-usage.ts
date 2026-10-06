// Deno-side Google Maps usage logging, environment resolution and request guard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type Env,
  isAllowedOrigin,
  normalizeEnv,
  sanitizeUsageRow,
  type UsageRow,
} from "./google-usage-core.ts";

let _svc: any = null;
export function serviceClient(): any {
  if (!_svc) {
    _svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _svc;
}

let _envCache: { env: Env; at: number } | null = null;
export async function platformEnvironment(supabase?: any): Promise<Env> {
  if (_envCache && Date.now() - _envCache.at < 60_000) return _envCache.env;
  try {
    const { data } = await (supabase ?? serviceClient()).rpc("get_platform_environment");
    _envCache = { env: normalizeEnv(data), at: Date.now() };
  } catch {
    _envCache = { env: "production", at: Date.now() };
  }
  return _envCache.env;
}

export async function sha256Short(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fc-usage:${input}`));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Best-effort, never throws, never logs keys/addresses/coordinates. */
export async function logGoogleUsage(row: UsageRow, supabase?: any): Promise<void> {
  try {
    const clean = sanitizeUsageRow(row);
    await (supabase ?? serviceClient()).from("api_usage_log").insert(clean);
  } catch (e) {
    console.warn("[google-usage] log failed", (e as Error)?.message);
  }
}

export interface GuardResult {
  ok: true;
  userId: string | null;
  userHash: string | null;
  ipHash: string | null;
  env: Env;
}

/**
 * Guard for browser-facing Google proxy endpoints:
 *  - requests with an Origin must come from an allowed app origin;
 *  - requests with no Origin (native/server) must carry a signed-in user;
 *  - optionally require a signed-in user outright;
 *  - fixed-window rate limit per user (or per IP for guests).
 */
export async function guardGoogleProxy(
  req: Request,
  opts: { fn: string; requireUser?: boolean; perMinuteUser?: number; perMinuteGuest?: number },
  corsHeaders: Record<string, string>,
): Promise<GuardResult | Response> {
  const svc = serviceClient();
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) return json({ error: "origin_not_allowed" }, 403);

  let userId: string | null = null;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    try {
      const { data } = await svc.auth.getUser(auth.slice(7));
      userId = data?.user?.id ?? null;
    } catch { /* anon key or invalid token */ }
  }
  if ((opts.requireUser || !origin) && !userId) return json({ error: "authentication_required" }, 401);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const userHash = userId ? await sha256Short(`u:${userId}`) : null;
  const ipHash = await sha256Short(`ip:${ip}`);
  const limit = userId ? (opts.perMinuteUser ?? 60) : (opts.perMinuteGuest ?? 20);
  const bucket = `${opts.fn}:${userHash ? `u:${userHash}` : `ip:${ipHash}`}`;
  try {
    const { data: allowed, error } = await svc.rpc("google_api_rate_hit", {
      p_key: bucket, p_limit: limit, p_window_seconds: 60,
    });
    if (!error && allowed === false) {
      const env = await platformEnvironment(svc);
      logGoogleUsage({
        provider: "google_maps", endpoint: opts.fn, function_name: opts.fn, environment: env,
        outcome: "rate_limited", status_code: 429, billable_elements: 0, cache_status: "none",
        user_hash: userHash, ip_hash: ipHash,
      }, svc);
      return json({ error: "rate_limited" }, 429);
    }
  } catch { /* limiter is best-effort; never blocks on its own failure */ }

  return { ok: true, userId, userHash, ipHash, env: await platformEnvironment(svc) };
}
