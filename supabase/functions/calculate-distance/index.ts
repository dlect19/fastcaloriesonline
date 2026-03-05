import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGoogleMapsDistance } from "../_shared/google-maps.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { originLat, originLng, destLat, destLng } = await req.json();

    if (!originLat || !originLng || !destLat || !destLng) {
      return new Response(
        JSON.stringify({ error: 'Missing coordinates: originLat, originLng, destLat, destLng required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`calculate-distance: ${originLat},${originLng} → ${destLat},${destLng}`);

    // Use shared helper which has Google Maps with automatic Haversine fallback
    const result = await getGoogleMapsDistance(originLat, originLng, destLat, destLng);

    console.log(`Result: ${result.distanceKm}km via ${result.source}`);

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
      JSON.stringify({ error: 'Internal error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
