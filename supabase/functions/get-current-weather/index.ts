// Returns the current weather condition for a lat/lon.
// Reads from weather_cache when a fresh row exists; otherwise calls the
// configured provider live and warms the cache. Used by the customer cart
// so the delivery fee at checkout uses the SAME weather condition that
// `dispatch-order` sees at rider dispatch time — otherwise the surge stored
// in `delivery_fee` under-prices the ride and the rider payout math (which
// subtracts today's surge from the fee) leaves the base looking tiny.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWeatherProvider } from "../_shared/weather-provider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FRESH_MINUTES = 15;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { lat, lon } = await req.json();
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(JSON.stringify({ condition: 'clear', reason: 'bad_coords' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const areaKey = `${lat.toFixed(1)},${lon.toFixed(1)}`;

    // 1. Try fresh cache row for this grid
    const { data: cached } = await supabase
      .from('weather_cache')
      .select('condition, updated_at')
      .eq('area_key', areaKey)
      .maybeSingle();

    if (cached?.condition && cached.updated_at) {
      const ageMin = (Date.now() - new Date(cached.updated_at).getTime()) / 60_000;
      if (ageMin < FRESH_MINUTES) {
        return new Response(JSON.stringify({ condition: cached.condition, source: 'cache' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. Miss / stale — hit provider live and warm the cache
    const { data: settings } = await supabase
      .from('platform_settings').select('key, value')
      .in('key', [
        'weather_service_provider',
        'rider_weather_surge_clear', 'rider_weather_surge_rain', 'rider_weather_surge_storm',
      ]);
    const s = Object.fromEntries((settings || []).map(r => [r.key, r.value])) as Record<string, string>;

    const provider = getWeatherProvider(s.weather_service_provider || 'open-meteo');
    let condition: 'clear' | 'rain' | 'storm' = 'clear';
    let reading: any = null;
    try {
      reading = await provider.fetch(lat, lon);
      condition = reading.condition;
    } catch (e) {
      console.warn('[get-current-weather] provider failed', e);
      // Fall back to cache row (even if stale) so we don't silently return 'clear'
      if (cached?.condition) condition = cached.condition as any;
    }

    if (reading) {
      const surge =
        condition === 'storm' ? parseFloat(s.rider_weather_surge_storm || '300')
        : condition === 'rain' ? parseFloat(s.rider_weather_surge_rain || '100')
        : parseFloat(s.rider_weather_surge_clear || '0');

      await supabase.from('weather_cache').upsert({
        area_key: areaKey,
        area_name: areaKey,
        latitude: lat,
        longitude: lon,
        condition,
        temperature: reading.temperature,
        rain_status: reading.rain_status,
        wind_speed: reading.wind_speed,
        surge_amount: surge,
        provider: provider.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'area_key' });
    }

    return new Response(JSON.stringify({ condition, source: reading ? 'live' : 'stale_cache' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-current-weather error', err);
    return new Response(JSON.stringify({ condition: 'clear', error: (err as Error).message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
