// Road route from the assigned rider's latest saved GPS to the order's saved delivery point.
// Customer-owned orders only; origin/destination are read server-side (never client-supplied).
// Google Routes API (computeRoutes) via the server key; cached, single-flight, daily-capped, logged.
import { guardGoogleProxy, logGoogleUsage, serviceClient } from "../_shared/google-usage.ts";
import { resolveDailyCap, selectServerMapsKey } from "../_shared/google-usage-core.ts";
import {
  computeRoutesBody, parseComputeRoutes, ROUTE_ACTIVE_STATUSES, ROUTE_CACHE_TTL_MS,
  ROUTE_MAX_LOCATION_AGE_MS, routeCacheKey, isUnsupportedTwoWheeler, ROUTES_FIELD_MASK,
} from "../_shared/rider-route-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type RouteOk = { ok: true; distance_m: number; duration_s: number; polyline: string; computed_at: string };
type RouteFail = { ok: false; reason: string };
const cache = new Map<string, { at: number; value: RouteOk }>();
const inFlight = new Map<string, Promise<RouteOk | RouteFail>>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);
  const guard = await guardGoogleProxy(req, { fn: "customer-rider-route", requireUser: true, perMinuteUser: 8 }, corsHeaders);
  if (guard instanceof Response) return guard;

  let orderId = "";
  try { orderId = String((await req.json())?.order_id ?? ""); } catch { /* invalid body */ }
  if (!UUID.test(orderId)) return json({ ok: false, reason: "invalid_order" }, 400);

  const svc = serviceClient();
  const { data: order } = await svc.from("orders")
    .select("id, user_id, status, delivery_type, delivery_latitude, delivery_longitude")
    .eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== guard.userId) return json({ ok: false, reason: "order_not_found" }, 404);
  if (order.delivery_type !== "delivery" || !ROUTE_ACTIVE_STATUSES.includes(order.status)) return json({ ok: false, reason: "not_in_transit" });
  const dlat = Number(order.delivery_latitude), dlng = Number(order.delivery_longitude);
  if (order.delivery_latitude == null || order.delivery_longitude == null || !Number.isFinite(dlat) || !Number.isFinite(dlng)) {
    return json({ ok: false, reason: "no_destination" });
  }

  const { data: loc } = await svc.from("rider_live_locations").select("lat, lng, received_at").eq("order_id", orderId).maybeSingle();
  if (!loc) return json({ ok: false, reason: "no_rider_location" });
  if (Date.now() - new Date(loc.received_at).getTime() > ROUTE_MAX_LOCATION_AGE_MS) return json({ ok: false, reason: "stale_location", origin_received_at: loc.received_at });

  const origin = { lat: Number(loc.lat), lng: Number(loc.lng) };
  const dest = { lat: dlat, lng: dlng };
  const key = routeCacheKey(guard.env, orderId, origin, dest);
  const base = { provider: "google_maps", endpoint: "routes_compute", api: "routes_compute", function_name: "customer-rider-route", environment: guard.env, user_hash: guard.userHash };

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_TTL_MS) {
    logGoogleUsage({ ...base, outcome: "cache_hit", billable_elements: 0, cost_estimate_usd: 0, cache_status: "hit" }, svc);
    return json({ ...hit.value, origin_received_at: loc.received_at, cached: true });
  }

  let p = inFlight.get(key);
  if (!p) {
    p = (async (): Promise<RouteOk | RouteFail> => {
      const apiKey = selectServerMapsKey(guard.env, (k) => Deno.env.get(k));
      if (!apiKey) { logGoogleUsage({ ...base, outcome: "key_missing", cache_status: "miss" }, svc); return { ok: false, reason: "key_missing" }; }
      let capSetting: unknown = null;
      try {
        const { data } = await svc.from("platform_settings").select("value")
          .eq("key", guard.env === "production" ? "google_routes_daily_cap" : "google_routes_daily_cap_dev").maybeSingle();
        capSetting = data?.value ?? null;
      } catch { /* default cap */ }
      const cap = resolveDailyCap(guard.env, capSetting);
      for (const mode of ["TWO_WHEELER", "DRIVE"] as const) {
        const { data: allowed, error: capErr } = await svc.rpc("google_api_reserve", { p_environment: guard.env, p_api: "routes_compute", p_elements: 1, p_cap: cap });
        if (capErr || allowed === false) { logGoogleUsage({ ...base, outcome: "cap_reached", cache_status: "miss", meta: { cap } }, svc); return { ok: false, reason: "cap_reached" }; }
        const t0 = Date.now();
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
        try {
          const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
            method: "POST", signal: ctl.signal,
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": ROUTES_FIELD_MASK },
            body: JSON.stringify(computeRoutesBody(origin, dest, mode)),
          });
          const latency = Date.now() - t0;
          if (!res.ok) {
            const text = await res.text();
            if (mode === "TWO_WHEELER" && isUnsupportedTwoWheeler(res.status, text)) {
              logGoogleUsage({ ...base, outcome: "failed", status_code: res.status, billable_elements: 0, latency_ms: latency, cache_status: "miss", meta: { reason: "two_wheeler_unsupported", mode } }, svc);
              continue; // single DRIVE attempt
            }
            let reason = "provider_error";
            if (res.status === 403) {
              try {
                const r = (JSON.parse(text)?.error?.details ?? []).find((d: any) => d?.reason)?.reason;
                reason = r === "API_KEY_SERVICE_BLOCKED" ? "routes_api_not_allowed_for_key" : r === "API_KEY_HTTP_REFERRER_BLOCKED" ? "server_key_referrer_restricted" : "routes_permission_denied";
              } catch { reason = "routes_permission_denied"; }
              if (/has not been used|is disabled|SERVICE_DISABLED/i.test(text)) reason = "routes_api_not_enabled";
            }
            console.error(`[customer-rider-route] Routes ${res.status} ${reason}`);
            logGoogleUsage({ ...base, outcome: "failed", status_code: res.status, billable_elements: 0, latency_ms: latency, cache_status: "miss", meta: { reason, mode } }, svc);
            return { ok: false, reason };
          }
          const parsed = parseComputeRoutes(await res.json());
          logGoogleUsage({ ...base, outcome: parsed.ok ? "success" : "failed", status_code: res.status, billable_elements: 1, cost_estimate_usd: 0.005, latency_ms: latency, cache_status: "miss", meta: { mode, result: parsed.ok ? "route" : parsed.reason } }, svc);
          if (parsed.ok) {
            const value: RouteOk = { ok: true, distance_m: parsed.distance_m, duration_s: parsed.duration_s, polyline: parsed.polyline, computed_at: new Date().toISOString() };
            cache.set(key, { at: Date.now(), value });
            if (cache.size > 500) cache.delete(cache.keys().next().value!);
            return value;
          }
          if (parsed.reason === "malformed") return { ok: false, reason: "malformed" };
          // no_route for two-wheeler (unsupported region) → one DRIVE attempt.
        } catch (e) {
          logGoogleUsage({ ...base, outcome: "failed", latency_ms: Date.now() - t0, cache_status: "miss", meta: { error: (e as Error)?.name === "AbortError" ? "timeout" : "network_error" } }, svc);
          return { ok: false, reason: "provider_unreachable" };
        } finally { clearTimeout(timer); }
      }
      return { ok: false, reason: "no_route" };
    })();
    inFlight.set(key, p);
    p.finally(() => inFlight.delete(key));
  }
  const result = await p;
  return json({ ...result, origin_received_at: loc.received_at });
});
