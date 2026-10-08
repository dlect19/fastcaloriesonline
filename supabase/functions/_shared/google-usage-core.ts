// Pure helpers for Google Maps cost control. No Deno/network imports so the
// same logic is unit-tested under vitest.

export type Env = "production" | "development";
export type LatLng = { lat: number; lng: number };

/** Estimated USD per billable element/request (Google list price, before credits). */
export const GOOGLE_SKU_COST_USD: Record<string, number> = {
  distance_matrix: 0.005,
  geocoding: 0.005,
  reverse_geocode: 0.005,
  places_autocomplete: 0.00283,
  place_details: 0.017,
  routes_compute: 0.005,
};

export const DEFAULT_DM_DAILY_CAP: Record<Env, number> = { production: 300, development: 50 };
export const ROAD_DISTANCE_PROVIDER_VERSION = "google_dm_v1";
export const ROAD_DISTANCE_CACHE_TTL_DAYS = 30;
/** One retry at most, only for transient failures. */
export const ROAD_DISTANCE_MAX_ATTEMPTS = 2;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ~110 m grid — absorbs GPS drift so nearby fixes share one cache row. */
export function roundCoord(n: number): string {
  return Number(n).toFixed(3);
}

export function buildDistanceCacheKey(env: Env, origin: LatLng, dest: LatLng): string {
  return [
    env, ROAD_DISTANCE_PROVIDER_VERSION,
    `${roundCoord(origin.lat)},${roundCoord(origin.lng)}`,
    `${roundCoord(dest.lat)},${roundCoord(dest.lng)}`,
  ].join("|");
}

/** Retry only on network errors, 429 and 5xx. Never on 4xx / provider "NOT_FOUND" etc. */
export function isTransientFailure(status: number | null): boolean {
  if (status === null) return true; // network error / timeout
  return status === 429 || status >= 500;
}

export function normalizeEnv(v: unknown): Env {
  return v === "development" ? "development" : "production";
}

/**
 * Server Maps key for an environment. Development never falls back to the
 * production key: it uses GOOGLE_MAPS_DEV_KEY or fails closed (null).
 */
export function selectServerMapsKey(env: Env, getEnv: (k: string) => string | undefined): string | null {
  if (env === "development") return getEnv("GOOGLE_MAPS_DEV_KEY") || null;
  return getEnv("GOOGLE_MAPS_KEY") || getEnv("GOOGLE_MAPS_API_KEY") || null;
}

/** Browser key only. Never returns a server key. */
export function selectBrowserMapsKey(getEnv: (k: string) => string | undefined): string | null {
  return getEnv("GOOGLE_MAPS_BROWSER_KEY") || null;
}

export function resolveDailyCap(env: Env, settingValue: unknown, envOverride?: string): number {
  const fromSetting = Number(settingValue);
  if (Number.isFinite(fromSetting) && fromSetting >= 0 && settingValue !== null && settingValue !== "") {
    return Math.floor(fromSetting);
  }
  const fromEnv = Number(envOverride);
  if (envOverride && Number.isFinite(fromEnv) && fromEnv >= 0) return Math.floor(fromEnv);
  return DEFAULT_DM_DAILY_CAP[env];
}

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/(www\.|app\.)?fastcalories\.online$/,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/,
  /^capacitor:\/\/localhost$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export interface UsageRow {
  provider: string;
  endpoint: string;
  api?: string;
  function_name: string;
  environment: Env;
  outcome: string;
  status_code?: number | null;
  billable_elements?: number;
  cost_estimate_usd?: number;
  latency_ms?: number | null;
  cache_status?: "hit" | "miss" | "bypass" | "none";
  user_hash?: string | null;
  ip_hash?: string | null;
  meta?: Record<string, unknown> | null;
}

const FORBIDDEN_META_KEYS = /key|token|secret|phone|address|lat|lng|lon|coord|email|password/i;

/** Drop anything that could be a secret or PII from the free-form meta. */
export function sanitizeUsageRow(row: UsageRow): UsageRow {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.meta || {})) {
    if (FORBIDDEN_META_KEYS.test(k)) continue;
    if (typeof v === "string" && (v.length > 120 || /AIza[0-9A-Za-z_-]{10,}/.test(v))) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) meta[k] = v;
  }
  const elements = Math.max(0, Math.floor(row.billable_elements ?? 0));
  return {
    ...row,
    billable_elements: elements,
    cost_estimate_usd: row.cost_estimate_usd ?? elements * (GOOGLE_SKU_COST_USD[row.api || row.endpoint] ?? 0),
    meta,
  };
}

export interface OutletLike {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  store_type?: string | null;
  state?: string | null;
  sales_radius?: number | null;
}

function normState(s: string | null | undefined) {
  return (s || "").toLowerCase().replace(/\s*state\s*/i, "").trim();
}

/**
 * Classify outlets for the browse list using straight-line distance only.
 * Each outlet appears at most once: physical-in-radius first, otherwise
 * state-matched online. Zero Google calls.
 */
export function selectBrowseOutlets<T extends OutletLike>(
  outlets: T[],
  customer: { lat: number; lng: number; state: string | null },
  defaultRadiusKm: number,
): Array<{ outlet: T; distanceKm: number; kind: "physical" | "online" }> {
  const seen = new Set<string>();
  const out: Array<{ outlet: T; distanceKm: number; kind: "physical" | "online" }> = [];
  const cState = normState(customer.state);

  for (const o of outlets) {
    if (seen.has(o.id)) continue;
    const type = o.store_type || "physical";
    const hasCoords = o.latitude != null && o.longitude != null;
    const km = hasCoords ? haversineKm(customer.lat, customer.lng, Number(o.latitude), Number(o.longitude)) : 0;
    const radius = o.sales_radius ?? defaultRadiusKm;

    if ((type === "physical" || type === "both") && hasCoords && km <= radius) {
      seen.add(o.id);
      out.push({ outlet: o, distanceKm: Math.round(km * 10) / 10, kind: "physical" });
      continue;
    }
    if (type === "online" || type === "both") {
      const oState = normState(o.state);
      const match = !!cState && !!oState && (oState === cState || oState.includes(cState) || cState.includes(oState));
      if (match) {
        seen.add(o.id);
        out.push({ outlet: o, distanceKm: hasCoords ? Math.round(km * 10) / 10 : 0, kind: "online" });
      }
    }
  }
  return out;
}
