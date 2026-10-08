// Pure helpers for customer live-route requests (no Deno/network imports; unit-tested).
export type RoutePoint = { lat: number; lng: number };

export const ROUTE_ACTIVE_STATUSES = ["assigned", "picked_up", "on_the_way"];
/** Rider fixes older than this are not routed (shown as last known only). */
export const ROUTE_MAX_LOCATION_AGE_MS = 5 * 60_000;
/** Server cache: same ~55 m origin cell + same destination reuses a route for 2 minutes. */
export const ROUTE_CACHE_TTL_MS = 120_000;
export const ROUTES_FIELD_MASK = "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline";

export function routeCacheKey(env: string, orderId: string, origin: RoutePoint, dest: RoutePoint): string {
  const r = (n: number, d: number) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);
  // 0.0005° ≈ 55 m origin cell absorbs GPS drift.
  const cell = (n: number) => (Math.round(n / 0.0005) * 0.0005).toFixed(4);
  return [env, orderId, `${cell(origin.lat)},${cell(origin.lng)}`, `${r(dest.lat, 5)},${r(dest.lng, 5)}`].join("|");
}

export function computeRoutesBody(origin: RoutePoint, dest: RoutePoint, travelMode: "TWO_WHEELER" | "DRIVE") {
  return {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode,
    routingPreference: "TRAFFIC_UNAWARE",
    polylineEncoding: "ENCODED_POLYLINE",
  };
}

export type ParsedRoute = { ok: true; distance_m: number; duration_s: number; polyline: string } | { ok: false; reason: "no_route" | "malformed" };

/** Routes API: omitted distanceMeters on a valid route means 0; geometry and duration are mandatory. */
export function parseComputeRoutes(body: any): ParsedRoute {
  const route = body?.routes?.[0];
  if (!route) return { ok: false, reason: "no_route" };
  const polyline = route?.polyline?.encodedPolyline;
  const dur = typeof route.duration === "string" ? Number(route.duration.replace(/s$/, "")) : NaN;
  const dist = route.distanceMeters === undefined ? 0 : Number(route.distanceMeters);
  if (typeof polyline !== "string" || !polyline || !Number.isFinite(dur) || dur < 0 || !Number.isFinite(dist) || dist < 0) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, distance_m: dist, duration_s: dur, polyline };
}

/**
 * True only when Google explicitly rejects TWO_WHEELER travel mode for this request/region.
 * Permission, key, billing, quota and network failures never qualify (no DRIVE retry for those).
 */
export function isUnsupportedTwoWheeler(status: number, text: string): boolean {
  if (status !== 400) return false;
  let msg = text;
  try {
    const e = JSON.parse(text)?.error;
    if (e?.status && e.status !== "INVALID_ARGUMENT") return false;
    msg = String(e?.message ?? text);
  } catch { /* plain text body */ }
  if (/billing|quota|api key|permission|referer|disabled/i.test(msg)) return false;
  return /TWO_WHEELER|two.?wheeler|travel ?mode/i.test(msg) && /not supported|unsupported|not available|isn't supported/i.test(msg);
}
