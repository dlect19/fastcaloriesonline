import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { guardGoogleProxy, logGoogleUsage } from "../_shared/google-usage.ts";
import { selectServerMapsKey } from "../_shared/google-usage-core.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

let _guard: any = null;
function logUsage(endpoint: string, outcome: 'success' | 'failed', costUsd: number) {
  logGoogleUsage({
    provider: 'google_maps', endpoint, api: endpoint, function_name: 'google-places-autocomplete',
    environment: _guard?.env ?? 'production', outcome, billable_elements: outcome === 'success' || costUsd > 0 ? 1 : 0,
    cost_estimate_usd: costUsd, cache_status: 'none', user_hash: _guard?.userHash ?? null, ip_hash: _guard?.ipHash ?? null,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const guard = await guardGoogleProxy(req, { fn: 'google-places-autocomplete', perMinuteUser: 60, perMinuteGuest: 30 }, corsHeaders);
  if (guard instanceof Response) return guard;
  _guard = guard;

  try {
    // Server key for this environment; development never uses the production key.
    const apiKey = selectServerMapsKey(guard.env, (k) => Deno.env.get(k));
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_MAPS_KEY not configured', predictions: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { input, sessionToken } = await req.json();

    if (!input || input.trim().length < 2) {
      return new Response(
        JSON.stringify({ predictions: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use Google Places Autocomplete API
    const params = new URLSearchParams({
      input: input.trim(),
      key: apiKey,
      components: 'country:ng', // Restrict to Nigeria
      types: 'geocode|establishment',
      language: 'en',
    });

    // Bias towards Lagos area
    params.set('location', '6.5244,3.3792');
    params.set('radius', '50000'); // 50km radius bias

    if (sessionToken) {
      params.set('sessiontoken', sessionToken);
    }

    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Places Autocomplete error:', data.status, data.error_message);
      logUsage('places_autocomplete', 'failed', 0);
      return new Response(
        JSON.stringify({ error: data.error_message || data.status, predictions: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logUsage('places_autocomplete', 'success', 0.00283);

    const predictions = (data.predictions || []).map((p: any) => ({
      place_id: p.place_id,
      description: p.description,
      main_text: p.structured_formatting?.main_text || p.description,
      secondary_text: p.structured_formatting?.secondary_text || '',
    }));

    return new Response(
      JSON.stringify({ predictions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Places autocomplete error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', predictions: [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
