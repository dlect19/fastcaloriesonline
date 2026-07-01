import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleMapsDistance } from "../_shared/google-maps.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function coordKey(a: number, b: number, c: number, d: number) {
  // ~11m precision (4 decimals) — treats near-identical coords as same cache row
  const r = (n: number) => n.toFixed(4);
  return `${r(a)},${r(b)}|${r(c)},${r(d)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { originLat, originLng, destLat, destLng, vendorId, customerAddressId } = body;

    if (!originLat || !originLng || !destLat || !destLng) {
      return new Response(
        JSON.stringify({ error: 'Missing coordinates' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const ck = coordKey(originLat, originLng, destLat, destLng);

    // 1. Try cache lookup
    let cacheQuery = supabase
      .from('delivery_distance_cache')
      .select('id, distance_km, duration_minutes, source, expires_at, hit_count')
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (vendorId && customerAddressId) {
      cacheQuery = cacheQuery.eq('vendor_id', vendorId).eq('customer_address_id', customerAddressId);
    } else {
      cacheQuery = cacheQuery.eq('coord_key', ck);
    }

    const { data: cached } = await cacheQuery.maybeSingle();

    if (cached) {
      // Bump hit counter (fire-and-forget)
      supabase.from('delivery_distance_cache')
        .update({ hit_count: (cached.hit_count || 0) + 1 })
        .eq('id', cached.id)
        .then(() => {});

      supabase.from('api_usage_log').insert({
        provider: 'google_maps', endpoint: 'distance_matrix',
        outcome: 'cache_hit', cost_estimate_usd: 0,
      }).then(() => {});

      console.log(`[calculate-distance] CACHE HIT ${cached.distance_km}km`);

      return new Response(
        JSON.stringify({
          distanceInKm: Number(cached.distance_km),
          durationInMinutes: cached.duration_minutes,
          distanceText: `${cached.distance_km} km`,
          durationText: `${cached.duration_minutes} min`,
          source: 'cache',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Miss — call Google (with Haversine fallback)
    const result = await getGoogleMapsDistance(originLat, originLng, destLat, destLng);
    console.log(`[calculate-distance] MISS → ${result.source} ${result.distanceKm}km`);

    // 3. Read TTL from settings and upsert cache
    const { data: ttlSetting } = await supabase
      .from('platform_settings').select('value').eq('key', 'distance_cache_ttl_days').maybeSingle();
    const ttlDays = parseInt(ttlSetting?.value || '30', 10);
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();

    const row = {
      vendor_id: vendorId || null,
      customer_address_id: customerAddressId || null,
      vendor_latitude: originLat,
      vendor_longitude: originLng,
      customer_latitude: destLat,
      customer_longitude: destLng,
      coord_key: ck,
      distance_km: result.distanceKm,
      duration_minutes: result.durationMinutes,
      source: result.source,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    if (vendorId && customerAddressId) {
      await supabase.from('delivery_distance_cache')
        .upsert(row, { onConflict: 'vendor_id,customer_address_id' });
    } else {
      await supabase.from('delivery_distance_cache').insert(row);
    }

    supabase.from('api_usage_log').insert({
      provider: result.source === 'google_maps' ? 'google_maps' : 'haversine',
      endpoint: 'distance_matrix',
      outcome: 'success',
      cost_estimate_usd: result.source === 'google_maps' ? 0.005 : 0,
    }).then(() => {});

    return new Response(
      JSON.stringify({
        distanceInKm: result.distanceKm,
        durationInMinutes: result.durationMinutes,
        distanceText: `${result.distanceKm} km`,
        durationText: `${result.durationMinutes} min`,
        source: result.source,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('calculate-distance error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
