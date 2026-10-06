// Returns the current weather condition for a lat/lon from the shared cached
// weather service — the same source quotes, checkout and dispatch use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSharedWeather } from "../_shared/weather-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { lat, lon } = await req.json();
    if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json({ condition: 'clear', reason: 'bad_coords' });
    }
    const w = await getSharedWeather(supabase, lat, lon, 'get-current-weather');
    return json({ condition: w.condition, source: w.source, observed_at: w.observedAt });
  } catch (err) {
    console.error('get-current-weather error', (err as Error).message);
    return json({ condition: 'clear', source: 'fallback' });
  }
});
