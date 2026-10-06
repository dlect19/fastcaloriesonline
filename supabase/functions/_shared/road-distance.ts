// The ONLY server path that calls Google Distance Matrix.
// Cache (rounded coords + environment + provider version) -> daily cap ->
// single-flight -> one bounded retry on transient failures -> usage log.
import {
  buildDistanceCacheKey,
  GOOGLE_SKU_COST_USD,
  haversineKm,
  isTransientFailure,
  type LatLng,
  resolveDailyCap,
  ROAD_DISTANCE_CACHE_TTL_DAYS,
  ROAD_DISTANCE_MAX_ATTEMPTS,
  ROAD_DISTANCE_PROVIDER_VERSION,
  selectServerMapsKey,
} from "./google-usage-core.ts";
import { logGoogleUsage, platformEnvironment, serviceClient } from "./google-usage.ts";

export type RoadDistanceOk = {
  ok: true;
  km: number;
  minutes: number | null;
  source: "google_maps" | "cache";
};
export type RoadDistanceFail = {
  ok: false;
  reason: "cap_reached" | "key_missing" | "provider_error";
  detail?: string;
};
export type RoadDistanceResult = RoadDistanceOk | RoadDistanceFail;

export interface RoadDistanceOpts {
  fn: string;
  userHash?: string | null;
  bypassCache?: boolean;
  supabase?: any;
}

const inFlight = new Map<string, Promise<RoadDistanceResult>>();

async function dailyCap(svc: any, env: "production" | "development"): Promise<number> {
  try {
    const { data } = await svc.from("platform_settings").select("value")
      .eq("key", env === "production" ? "google_distance_matrix_daily_cap" : "google_distance_matrix_daily_cap_dev")
      .maybeSingle();
    return resolveDailyCap(env, data?.value ?? null, Deno.env.get("GOOGLE_DM_DAILY_CAP") ?? undefined);
  } catch {
    return resolveDailyCap(env, null);
  }
}

export async function getRoadDistance(
  origin: LatLng,
  dest: LatLng,
  opts: RoadDistanceOpts,
): Promise<RoadDistanceResult> {
  const svc = opts.supabase ?? serviceClient();
  const env = await platformEnvironment(svc);
  const key = buildDistanceCacheKey(env, origin, dest);
  const base = {
    provider: "google_maps", endpoint: "distance_matrix", api: "distance_matrix",
    function_name: opts.fn, environment: env, user_hash: opts.userHash ?? null,
  };

  // 1. Cache
  if (!opts.bypassCache) {
    try {
      const { data: hit } = await svc.from("delivery_distance_cache")
        .select("id, distance_km, duration_minutes, hit_count")
        .eq("cache_key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (hit) {
        svc.from("delivery_distance_cache").update({ hit_count: (hit.hit_count || 0) + 1 }).eq("id", hit.id).then(() => {});
        logGoogleUsage({ ...base, outcome: "cache_hit", billable_elements: 0, cost_estimate_usd: 0, cache_status: "hit" }, svc);
        return { ok: true, km: Number(hit.distance_km), minutes: hit.duration_minutes, source: "cache" };
      }
    } catch { /* cache best-effort */ }
  }

  // 2. Single-flight per isolate
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = (async (): Promise<RoadDistanceResult> => {
    const apiKey = selectServerMapsKey(env, (k) => Deno.env.get(k));
    if (!apiKey) {
      logGoogleUsage({ ...base, outcome: "key_missing", billable_elements: 0, cache_status: "miss" }, svc);
      return { ok: false, reason: "key_missing" };
    }

    // 3. Daily cap (reserve the element before spending it)
    const cap = await dailyCap(svc, env);
    const { data: allowed, error: capErr } = await svc.rpc("google_api_reserve", {
      p_environment: env, p_api: "distance_matrix", p_elements: 1, p_cap: cap,
    });
    if (capErr || allowed === false) {
      logGoogleUsage({ ...base, outcome: "cap_reached", billable_elements: 0, cache_status: "miss",
        meta: { cap, reserve_error: capErr ? "rpc_error" : null } }, svc);
      return { ok: false, reason: "cap_reached" };
    }

    // 4. Provider call, one bounded retry on transient failures only
    let lastDetail = "";
    for (let attempt = 1; attempt <= ROAD_DISTANCE_MAX_ATTEMPTS; attempt++) {
      const t0 = Date.now();
      let status: number | null = null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${dest.lat},${dest.lng}&key=${apiKey}`;
        const res = await fetch(url, { signal: controller.signal });
        status = res.status;
        const d = res.ok ? await res.json() : (await res.text(), null);
        const el = d?.rows?.[0]?.elements?.[0];
        const latency = Date.now() - t0;
        if (d?.status === "OK" && el?.status === "OK") {
          const km = Math.round((el.distance.value / 1000) * 10) / 10;
          const minutes = Math.round(el.duration.value / 60);
          logGoogleUsage({ ...base, outcome: "success", status_code: status, billable_elements: 1,
            cost_estimate_usd: GOOGLE_SKU_COST_USD.distance_matrix, latency_ms: latency, cache_status: "miss",
            meta: { attempt } }, svc);
          const expires = new Date(Date.now() + ROAD_DISTANCE_CACHE_TTL_DAYS * 86400_000).toISOString();
          await svc.from("delivery_distance_cache").upsert({
            cache_key: key, coord_key: key, environment: env, provider_version: ROAD_DISTANCE_PROVIDER_VERSION,
            vendor_latitude: origin.lat, vendor_longitude: origin.lng,
            customer_latitude: dest.lat, customer_longitude: dest.lng,
            distance_km: km, duration_minutes: minutes, source: "google_maps",
            expires_at: expires, updated_at: new Date().toISOString(),
          }, { onConflict: "cache_key" }).then(() => {}, () => {});
          return { ok: true, km, minutes, source: "google_maps" };
        }
        // Google answered: a billed element even when the route is not found.
        lastDetail = `status_${d?.status ?? status}_${el?.status ?? "none"}`;
        logGoogleUsage({ ...base, outcome: "failed", status_code: status, billable_elements: d ? 1 : 0,
          latency_ms: latency, cache_status: "miss", meta: { attempt, provider_status: String(d?.status ?? "") } }, svc);
        const transient = isTransientFailure(status) || d?.status === "OVER_QUERY_LIMIT" || d?.status === "UNKNOWN_ERROR";
        if (!transient) break;
      } catch (e) {
        lastDetail = (e as Error)?.name === "AbortError" ? "timeout" : "network_error";
        logGoogleUsage({ ...base, outcome: "failed", status_code: null, billable_elements: 0,
          latency_ms: Date.now() - t0, cache_status: "miss", meta: { attempt, error: lastDetail } }, svc);
        if (!isTransientFailure(status)) break;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < ROAD_DISTANCE_MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400));
    }
    return { ok: false, reason: "provider_error", detail: lastDetail };
  })();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}

/** Road distance for non-pricing uses (dispatch, rider logs); straight-line when unavailable. */
export async function roadDistanceOrStraight(
  origin: LatLng, dest: LatLng, opts: RoadDistanceOpts,
): Promise<{ distanceKm: number; durationMinutes: number; source: "google_maps" | "cache" | "haversine" }> {
  const r = await getRoadDistance(origin, dest, opts);
  if (r.ok) return { distanceKm: r.km, durationMinutes: r.minutes ?? Math.round((r.km / 25) * 60), source: r.source };
  const km = Math.round(haversineKm(origin.lat, origin.lng, dest.lat, dest.lng) * 10) / 10;
  return { distanceKm: km, durationMinutes: Math.round((km / 25) * 60), source: "haversine" };
}
