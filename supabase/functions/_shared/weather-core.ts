// Pure weather cache/refresh logic shared by dispatch, quotes, checkout
// validation, the customer cart and the admin refresh. No Deno/network imports
// so it is unit-tested under vitest; edge functions bind the deps in
// weather-service.ts.

export type WeatherEnv = "production" | "development";
export type WeatherCondition = "clear" | "rain" | "storm";

/** A cached reading younger than this is used without any external call. */
export const WEATHER_CACHE_TTL_MIN = 15;
/** After a failed refresh, a reading up to this old may still be used. */
export const WEATHER_MAX_STALE_MIN = 120;
/** A quote's weather snapshot is reused at checkout while younger than this. */
export const WEATHER_SNAPSHOT_VALID_MIN = 15;
export const WEATHER_FETCH_TIMEOUT_MS = 4000;
/** One retry at most, only for transient failures. */
export const WEATHER_MAX_ATTEMPTS = 2;

/** ~11 km grid; development rows are kept apart from production rows. */
export function weatherAreaKey(env: WeatherEnv, lat: number, lon: number): string {
  const k = `${Number(lat).toFixed(1)},${Number(lon).toFixed(1)}`;
  return env === "production" ? k : `dev:${k}`;
}

export function normalizeCondition(v: unknown): WeatherCondition {
  return v === "rain" || v === "storm" ? v : "clear";
}

/** WMO weather code → condition (Open-Meteo). */
export function conditionFromWmo(code: number): WeatherCondition {
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "clear";
}

export function weatherSurgeFor(
  condition: WeatherCondition,
  s: { clear: number; rain: number; storm: number },
): number {
  return condition === "storm" ? s.storm : condition === "rain" ? s.rain : s.clear;
}

export function ageMinutes(iso: string | null | undefined, now: number): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (now - t) / 60_000 : Infinity;
}

export interface WeatherSnapshot { condition?: unknown; observedAt?: string | null }

/** Checkout reuses the quote's weather while it is still valid; otherwise null (re-resolve). */
export function usableSnapshot(snap: WeatherSnapshot | null | undefined, now: number): WeatherCondition | null {
  if (!snap || !snap.condition || !snap.observedAt) return null;
  const age = ageMinutes(snap.observedAt, now);
  if (age < 0 || age > WEATHER_SNAPSHOT_VALID_MIN) return null;
  return normalizeCondition(snap.condition);
}

export function isTransientWeatherError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  const m = msg.match(/http (\d{3})/);
  if (m) {
    const code = Number(m[1]);
    return code === 429 || code >= 500;
  }
  return true; // timeout / network
}

export interface WeatherReading {
  condition: WeatherCondition;
  temperature: number | null;
  wind_speed: number | null;
  rain_status: WeatherCondition;
}
export interface CachedWeather { condition: string; updated_at: string }

export interface WeatherLogRow {
  provider: string;
  endpoint: "current_weather";
  api: "weather";
  function_name: string;
  environment: WeatherEnv;
  outcome: string;
  latency_ms: number | null;
  cache_status: "hit" | "miss" | "bypass";
  billable_elements: 0;
  cost_estimate_usd: 0;
  meta: Record<string, string | number | boolean | null>;
}

export interface WeatherDeps {
  env: WeatherEnv;
  providerName: string;
  /** Admin "weather service enabled". When off, no external call is made. */
  enabled: boolean;
  readCache(key: string): Promise<CachedWeather | null>;
  writeCache(key: string, lat: number, lon: number, r: WeatherReading): Promise<void>;
  fetchReading(lat: number, lon: number): Promise<WeatherReading>;
  log(row: WeatherLogRow): void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface WeatherResult {
  condition: WeatherCondition;
  source: "cache" | "live" | "stale_cache" | "fallback";
  observedAt: string | null;
  areaKey: string;
}

const inflight = new Map<string, Promise<WeatherResult>>();
/** Test hook. */
export function _resetWeatherInflight() { inflight.clear(); }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("weather timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Fresh cache → live provider (bounded timeout/retry) → stale cache within
 * WEATHER_MAX_STALE_MIN → clear/no-surge fallback. Concurrent callers for the
 * same grid share one in-flight resolution (single-flight per instance).
 */
export function resolveWeather(lat: number, lon: number, deps: WeatherDeps, fn: string): Promise<WeatherResult> {
  const key = weatherAreaKey(deps.env, lat, lon);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = doResolve(key, lat, lon, deps, fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doResolve(key: string, lat: number, lon: number, d: WeatherDeps, fn: string): Promise<WeatherResult> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const grid = key.replace(/^dev:/, "");
  const log = (outcome: string, cache: WeatherLogRow["cache_status"], latency: number | null, meta: WeatherLogRow["meta"] = {}) => {
    try {
      const r = d.log({
        provider: d.providerName, endpoint: "current_weather", api: "weather", function_name: fn,
        environment: d.env, outcome, latency_ms: latency, cache_status: cache,
        billable_elements: 0, cost_estimate_usd: 0, meta: { grid, ...meta },
      });
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch { /* logging never breaks pricing */ }
  };

  let cached: CachedWeather | null = null;
  try { cached = await d.readCache(key); } catch { cached = null; }
  const age = cached ? ageMinutes(cached.updated_at, now()) : Infinity;
  if (cached && age < WEATHER_CACHE_TTL_MIN) {
    return { condition: normalizeCondition(cached.condition), source: "cache", observedAt: cached.updated_at, areaKey: key };
  }

  const staleOrFallback = (reason: string): WeatherResult => {
    if (cached && age <= WEATHER_MAX_STALE_MIN) {
      log(`stale_cache_${reason}`, "hit", null, { age_min: Math.round(age) });
      return { condition: normalizeCondition(cached.condition), source: "stale_cache", observedAt: cached.updated_at, areaKey: key };
    }
    log(`fallback_clear_${reason}`, "bypass", null);
    return { condition: "clear", source: "fallback", observedAt: null, areaKey: key };
  };

  if (!d.enabled) return staleOrFallback("disabled");

  for (let attempt = 1; attempt <= WEATHER_MAX_ATTEMPTS; attempt++) {
    const t0 = now();
    try {
      const reading = await withTimeout(d.fetchReading(lat, lon), d.timeoutMs ?? WEATHER_FETCH_TIMEOUT_MS);
      const latency = now() - t0;
      const condition = normalizeCondition(reading.condition);
      const observedAt = new Date(now()).toISOString();
      try { await d.writeCache(key, lat, lon, { ...reading, condition }); } catch { /* cache best-effort */ }
      log("success", "miss", latency, { attempt });
      return { condition, source: "live", observedAt, areaKey: key };
    } catch (e) {
      const transient = isTransientWeatherError(e);
      log("failed", "miss", now() - t0, { attempt, transient, reason: String((e as Error)?.message ?? "error").slice(0, 60) });
      if (!transient || attempt >= WEATHER_MAX_ATTEMPTS) break;
      await sleep(300);
    }
  }
  return staleOrFallback("provider_failed");
}
