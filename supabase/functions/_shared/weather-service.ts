// The single weather source for dispatch, delivery quotes, checkout
// validation, the customer cart and the admin refresh. Binds weather-core to
// the database cache, the admin-selected provider and api_usage_log.
import { getWeatherProvider } from "./weather-provider.ts";
import { platformEnvironment } from "./google-usage.ts";
import { resolveWeather, weatherSurgeFor, type WeatherResult } from "./weather-core.ts";

export interface WeatherServiceSettings {
  provider: string;
  enabled: boolean;
  surge: { clear: number; rain: number; storm: number };
}

export async function loadWeatherSettings(supabase: any): Promise<WeatherServiceSettings> {
  const { data } = await supabase.from("platform_settings").select("key, value").in("key", [
    "weather_service_provider", "weather_service_enabled",
    "rider_weather_surge_clear", "rider_weather_surge_rain", "rider_weather_surge_storm",
  ]);
  const s = Object.fromEntries((data || []).map((r: any) => [r.key, r.value])) as Record<string, string>;
  const n = (v: string | undefined, d: number) => (Number.isFinite(parseFloat(v ?? "")) ? parseFloat(v!) : d);
  return {
    provider: s.weather_service_provider || "open-meteo",
    enabled: s.weather_service_enabled !== "false",
    surge: {
      clear: n(s.rider_weather_surge_clear, 0),
      rain: n(s.rider_weather_surge_rain, 100),
      storm: n(s.rider_weather_surge_storm, 300),
    },
  };
}

export async function getSharedWeather(
  supabase: any,
  lat: number,
  lon: number,
  fn: string,
  preloaded?: WeatherServiceSettings,
): Promise<WeatherResult> {
  const ws = preloaded ?? await loadWeatherSettings(supabase);
  const env = await platformEnvironment(supabase);
  const provider = getWeatherProvider(ws.provider);
  return resolveWeather(lat, lon, {
    env,
    providerName: provider.name,
    enabled: ws.enabled,
    readCache: async (key) => {
      const { data } = await supabase.from("weather_cache").select("condition, updated_at").eq("area_key", key).maybeSingle();
      return data?.condition && data.updated_at ? data : null;
    },
    writeCache: async (key, la, lo, r) => {
      await supabase.from("weather_cache").upsert({
        area_key: key, area_name: key,
        // Stored at grid precision only.
        latitude: Number(Number(la).toFixed(1)), longitude: Number(Number(lo).toFixed(1)),
        condition: r.condition, temperature: r.temperature, rain_status: r.rain_status, wind_speed: r.wind_speed,
        surge_amount: weatherSurgeFor(r.condition, ws.surge),
        provider: provider.name, updated_at: new Date().toISOString(),
      }, { onConflict: "area_key" });
    },
    fetchReading: (la, lo) => provider.fetch(la, lo),
    log: async (row) => { await supabase.from("api_usage_log").insert(row); },
  }, fn);
}
