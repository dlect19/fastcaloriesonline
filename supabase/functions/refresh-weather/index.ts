import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWeatherProvider } from "../_shared/weather-provider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const forceRun: boolean = !!body?.force;

    // Load gating settings
    const { data: settings } = await supabase
      .from('platform_settings').select('key, value')
      .in('key', [
        'weather_service_enabled', 'weather_service_provider',
        'weather_service_business_hours_only', 'weather_service_business_start_hour', 'weather_service_business_end_hour',
        'weather_service_only_when_riders_online', 'weather_service_only_when_active_orders',
        'rider_weather_surge_clear', 'rider_weather_surge_rain', 'rider_weather_surge_storm',
      ]);
    const s = Object.fromEntries((settings || []).map(r => [r.key, r.value])) as Record<string, string>;

    if (!forceRun) {
      if (s.weather_service_enabled === 'false') {
        return new Response(JSON.stringify({ skipped: 'disabled' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (s.weather_service_business_hours_only === 'true') {
        const h = new Date().getHours();
        const start = parseInt(s.weather_service_business_start_hour || '7');
        const end = parseInt(s.weather_service_business_end_hour || '23');
        if (h < start || h >= end) {
          return new Response(JSON.stringify({ skipped: 'outside_business_hours' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      if (s.weather_service_only_when_riders_online === 'true') {
        const { count } = await supabase.from('rider_profiles').select('id', { count: 'exact', head: true }).eq('is_online', true);
        if (!count) {
          return new Response(JSON.stringify({ skipped: 'no_online_riders' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      if (s.weather_service_only_when_active_orders === 'true') {
        const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'assigned', 'picked_up', 'in_transit']);
        if (!count) {
          return new Response(JSON.stringify({ skipped: 'no_active_orders' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // Discover areas: existing cache entries + any vendor with coords (dedup by 0.1° grid)
    const { data: vendors } = await supabase
      .from('vendors').select('id, name, latitude, longitude')
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(200);

    const grid = new Map<string, { lat: number; lon: number; name: string }>();
    (vendors || []).forEach(v => {
      const key = `${(v.latitude as number).toFixed(1)},${(v.longitude as number).toFixed(1)}`;
      if (!grid.has(key)) grid.set(key, { lat: v.latitude!, lon: v.longitude!, name: v.name ?? key });
    });
    if (grid.size === 0) {
      grid.set('6.5,3.3', { lat: 6.5244, lon: 3.3792, name: 'Lagos' });
    }

    const surgeClear = parseFloat(s.rider_weather_surge_clear || '0');
    const surgeRain = parseFloat(s.rider_weather_surge_rain || '100');
    const surgeStorm = parseFloat(s.rider_weather_surge_storm || '300');

    let updated = 0;
    for (const [areaKey, { lat, lon, name }] of grid) {
      try {
        const w = await fetchOpenMeteo(lat, lon);
        const surge = w.condition === 'storm' ? surgeStorm : w.condition === 'rain' ? surgeRain : surgeClear;
        await supabase.from('weather_cache').upsert({
          area_key: areaKey,
          area_name: name,
          latitude: lat,
          longitude: lon,
          condition: w.condition,
          temperature: w.temperature,
          rain_status: w.rain_status,
          wind_speed: w.wind_speed,
          surge_amount: surge,
          provider: s.weather_service_provider || 'open-meteo',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'area_key' });

        await supabase.from('api_usage_log').insert({
          provider: 'open-meteo', endpoint: 'current_weather',
          outcome: 'success', cost_estimate_usd: 0,
        });
        updated++;
      } catch (e) {
        console.warn('weather fetch failed for', areaKey, e);
        await supabase.from('api_usage_log').insert({
          provider: 'open-meteo', endpoint: 'current_weather',
          outcome: 'failed', cost_estimate_usd: 0,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, areas_updated: updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('refresh-weather error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
