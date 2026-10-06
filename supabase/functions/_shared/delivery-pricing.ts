// Server-authoritative delivery pricing engine.
//
// This is the ONLY place a customer-facing delivery fee may be calculated.
// Web/mobile checkout, WhatsApp ordering and Assisted Order all go through
// `quote-delivery-fee`, which wraps this module, and the payment functions
// re-run it to validate what was stored on the order. Client-supplied fees,
// distances and totals are never trusted.
//
// Pricing sources (persisted on orders.delivery_pricing_source):
//   google_distance -> live road distance from the configured map provider
//   proximity       -> customer is within the 500m drift threshold (0 km)
//   distance_cache  -> recent road-distance result reused from cache
//   fallback_fee    -> live pricing failed and admin configured a fallback fee
// A plain base-fee guess is NEVER used as a fallback.

import { haversineDistance } from "./google-maps.ts";
import { getRoadDistance } from "./road-distance.ts";
import { getWeatherProvider } from "./weather-provider.ts";

export const PROXIMITY_THRESHOLD_KM = 0.5;

export interface PricingSettings {
  baseDeliveryFee: number;
  baseDeliveryDistanceKm: number;
  perKmFee: number;
  maxDeliveryDistanceKm: number;
  // Fallback (distinct from the ordinary base fee)
  fallbackEnabled: boolean;
  fallbackFee: number;
  retryCount: number;
  // Surge
  surgeEnabled: boolean;
  timeSurgeEnabled: boolean;
  weatherSurgeEnabled: boolean;
  maxSurgeCap: number;
  morningStartHour: number;
  morningEndHour: number;
  afternoonStartHour: number;
  afternoonEndHour: number;
  nightStartHour: number;
  timeSurgeMorning: number;
  timeSurgeAfternoon: number;
  timeSurgeNight: number;
  weatherSurgeClear: number;
  weatherSurgeRain: number;
  weatherSurgeStorm: number;
  supplySurgeEnabled: boolean;
  supplyMinThreshold: number;
  supplySurgePct: number;
  supplyCriticalThreshold: number;
  supplyEmergencySurgePct: number;
  mapProvider: string;
  weatherProvider: string;
}

export type PricingSource =
  | "google_distance"
  | "distance_cache"
  | "proximity"
  | "fallback_fee";

export interface PricingQuote {
  ok: true;
  deliveryFee: number;
  baseFee: number;
  surgeFee: number;
  distanceKm: number | null;
  source: PricingSource;
  outOfRange: boolean;
  maxDistanceKm: number;
  isEstimate: boolean;
  meta: Record<string, unknown>;
}

export interface PricingFailure {
  ok: false;
  reason: string;
  message: string;
  meta: Record<string, unknown>;
}

const num = (v: string | undefined, d: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === null || v === "" ? d : v === "true";

export async function loadPricingSettings(supabase: any): Promise<PricingSettings> {
  const { data } = await supabase.from("platform_settings").select("key, value");
  const s: Record<string, string> = {};
  (data || []).forEach((r: { key: string; value: string }) => { s[r.key] = r.value; });

  return {
    baseDeliveryFee: num(s.base_delivery_fee, 500),
    baseDeliveryDistanceKm: num(s.base_delivery_distance_km, 1),
    perKmFee: num(s.per_km_fee, 300),
    maxDeliveryDistanceKm: num(s.max_delivery_distance_km, 15),
    fallbackEnabled: bool(s.delivery_pricing_fallback_enabled, false),
    fallbackFee: num(s.delivery_pricing_fallback_fee, 0),
    retryCount: Math.max(0, Math.min(5, Math.round(num(s.delivery_pricing_retry_count, 2)))),
    surgeEnabled: bool(s.rider_surge_enabled, true),
    timeSurgeEnabled: bool(s.rider_time_surge_enabled, true),
    weatherSurgeEnabled: bool(s.rider_weather_surge_enabled, true),
    maxSurgeCap: num(s.rider_max_surge_cap, 500),
    morningStartHour: num(s.rider_morning_start_hour, 6),
    morningEndHour: num(s.rider_morning_end_hour, 12),
    afternoonStartHour: num(s.rider_afternoon_start_hour, 12),
    afternoonEndHour: num(s.rider_afternoon_end_hour, 18),
    nightStartHour: num(s.rider_night_start_hour, 18),
    timeSurgeMorning: num(s.rider_time_surge_morning, 0),
    timeSurgeAfternoon: num(s.rider_time_surge_afternoon, 100),
    timeSurgeNight: num(s.rider_time_surge_night, 200),
    weatherSurgeClear: num(s.rider_weather_surge_clear, 0),
    weatherSurgeRain: num(s.rider_weather_surge_rain, 100),
    weatherSurgeStorm: num(s.rider_weather_surge_storm, 300),
    supplySurgeEnabled: bool(s.rider_supply_surge_enabled, false),
    supplyMinThreshold: num(s.rider_supply_min_threshold, 5),
    supplySurgePct: num(s.rider_supply_surge_pct, 15),
    supplyCriticalThreshold: num(s.rider_supply_critical_threshold, 2),
    supplyEmergencySurgePct: num(s.rider_supply_emergency_surge_pct, 25),
    mapProvider: s.map_provider || "google",
    weatherProvider: s.weather_service_provider || "open-meteo",
  };
}

/** Current hour in Africa/Lagos — never the caller's clock. */
function lagosHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", hour12: false,
  }).format(new Date());
  return parseInt(parts, 10);
}

function timePeriod(s: PricingSettings): "morning" | "afternoon" | "night" {
  const h = lagosHour();
  if (h >= s.morningStartHour && h < s.morningEndHour) return "morning";
  if (h >= s.afternoonStartHour && h < s.afternoonEndHour) return "afternoon";
  if (h >= s.nightStartHour || h < s.morningStartHour) return "night";
  return "morning";
}

async function currentWeatherCondition(
  supabase: any,
  s: PricingSettings,
  lat: number,
  lon: number,
): Promise<string> {
  const areaKey = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  try {
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("condition, updated_at")
      .eq("area_key", areaKey)
      .maybeSingle();
    if (cached?.condition && cached.updated_at) {
      const ageMin = (Date.now() - new Date(cached.updated_at).getTime()) / 60_000;
      if (ageMin < 15) return cached.condition;
    }
    const provider = getWeatherProvider(s.weatherProvider);
    const reading = await provider.fetch(lat, lon);
    return reading.condition;
  } catch (_e) {
    return "clear";
  }
}

async function supplySurgePct(supabase: any, s: PricingSettings): Promise<number> {
  if (!s.supplySurgeEnabled) return 0;
  try {
    const { count } = await supabase
      .from("rider_profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .eq("is_online", true);
    const online = count ?? 0;
    if (online <= s.supplyCriticalThreshold) return s.supplyEmergencySurgePct;
    if (online <= s.supplyMinThreshold) return s.supplySurgePct;
    return 0;
  } catch {
    return 0;
  }
}

function distanceFee(s: PricingSettings, km: number): number {
  const effective = km <= s.baseDeliveryDistanceKm * 1.1
    ? Math.min(km, s.baseDeliveryDistanceKm)
    : km;
  if (effective <= s.baseDeliveryDistanceKm) return s.baseDeliveryFee;
  return Math.round(s.baseDeliveryFee + (effective - s.baseDeliveryDistanceKm) * s.perKmFee);
}

export interface QuoteInput {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  vendorId?: string | null;
  customerAddressId?: string | null;
  /** Skip the distance cache (used when validating an existing order). */
  skipCache?: boolean;
  /** Edge function name, for usage attribution. */
  callerFn?: string;
}

export async function quoteDeliveryFee(
  supabase: any,
  input: QuoteInput,
  preloaded?: PricingSettings,
): Promise<PricingQuote | PricingFailure> {
  const s = preloaded ?? await loadPricingSettings(supabase);
  const origin = { lat: Number(input.originLat), lng: Number(input.originLng) };
  const dest = { lat: Number(input.destLat), lng: Number(input.destLng) };

  const attempts: string[] = [];
  let km: number | null = null;
  let source: PricingSource | null = null;

  const straight = haversineDistance(origin.lat, origin.lng, dest.lat, dest.lng);
  if (straight < PROXIMITY_THRESHOLD_KM) {
    km = 0;
    source = "proximity";
  }

  // Road distance: cached (rounded coords + environment) or one live Google
  // element under the daily cap, with one bounded retry on transient errors.
  let capReached = false;
  if (km === null) {
    const res = await getRoadDistance(origin, dest, {
      fn: input.callerFn || "delivery-pricing",
      bypassCache: !!input.skipCache,
      supabase,
    });
    if (res.ok) {
      km = res.km < PROXIMITY_THRESHOLD_KM ? 0 : res.km;
      source = res.source === "cache" ? "distance_cache" : "google_distance";
    } else {
      attempts.push(`${res.reason}${res.detail ? ":" + res.detail : ""}`);
      capReached = res.reason === "cap_reached";
    }
  }

  // Live pricing unavailable — explicit configured fallback only.
  if (km === null || source === null) {
    if (!s.fallbackEnabled || !(s.fallbackFee > 0)) {
      return {
        ok: false,
        reason: capReached ? "distance_cap_reached" : "pricing_unavailable",
        message: capReached
          ? "Delivery pricing is temporarily unavailable. Please try again later or choose carryout."
          : "We couldn't work out the delivery price for this address right now. Please try again in a moment.",
        meta: { attempts, straight_line_km: Math.round(straight * 10) / 10 },
      };
    }
    return {
      ok: true,
      deliveryFee: Math.round(s.fallbackFee),
      baseFee: Math.round(s.fallbackFee),
      surgeFee: 0,
      distanceKm: null,
      source: "fallback_fee",
      outOfRange: false,
      maxDistanceKm: s.maxDeliveryDistanceKm,
      isEstimate: true,
      meta: { attempts, straight_line_km: Math.round(straight * 10) / 10 },
    };
  }

  // Surge — the customer-facing portion, computed from trusted server state.
  let surgeFee = 0;
  let condition = "clear";
  let period = "morning";
  let supplyPct = 0;
  const baseFee = distanceFee(s, km);

  if (s.surgeEnabled) {
    period = timePeriod(s);
    let timeSurge = 0;
    if (s.timeSurgeEnabled) {
      timeSurge = period === "morning"
        ? s.timeSurgeMorning
        : period === "afternoon" ? s.timeSurgeAfternoon : s.timeSurgeNight;
    }
    let weatherSurge = 0;
    if (s.weatherSurgeEnabled) {
      condition = await currentWeatherCondition(supabase, s, dest.lat, dest.lng);
      weatherSurge = condition === "storm"
        ? s.weatherSurgeStorm
        : condition === "rain" ? s.weatherSurgeRain : s.weatherSurgeClear;
    }
    surgeFee = Math.min(timeSurge + weatherSurge, s.maxSurgeCap);
    supplyPct = await supplySurgePct(supabase, s);
    if (supplyPct > 0) surgeFee += Math.round(baseFee * (supplyPct / 100));
  }

  return {
    ok: true,
    deliveryFee: Math.round(baseFee + surgeFee),
    baseFee,
    surgeFee,
    distanceKm: km,
    source,
    outOfRange: km > s.maxDeliveryDistanceKm,
    maxDistanceKm: s.maxDeliveryDistanceKm,
    isEstimate: false,
    meta: {
      time_period: period,
      weather_condition: condition,
      supply_surge_pct: supplyPct,
      per_km_fee: s.perKmFee,
      base_distance_km: s.baseDeliveryDistanceKm,
      attempts,
    },
  };
}
