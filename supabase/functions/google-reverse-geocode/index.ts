import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function logUsage(endpoint: string, outcome: 'success' | 'failed', costUsd: number) {
  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    supa.from('api_usage_log').insert({
      provider: 'google_maps', endpoint, outcome, cost_estimate_usd: costUsd,
    }).then(() => {});
  } catch (_) { /* best-effort */ }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GOOGLE_MAPS_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_MAPS_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { latitude, longitude } = await req.json();

    if (!latitude || !longitude) {
      return new Response(
        JSON.stringify({ error: 'latitude and longitude are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.length) {
      console.error('Reverse geocode error:', data.status, data.error_message);
      return new Response(
        JSON.stringify({ 
          error: data.error_message || 'No results',
          formatted_address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          city: '',
          state: '',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the first (most specific) result
    const result = data.results[0];
    const components = result.address_components || [];

    let streetNumber = '';
    let route = '';
    let neighborhood = '';
    let city = '';
    let state = '';

    for (const comp of components) {
      if (comp.types.includes('street_number')) streetNumber = comp.long_name;
      if (comp.types.includes('route')) route = comp.long_name;
      if (comp.types.includes('neighborhood') || comp.types.includes('sublocality_level_1')) {
        neighborhood = comp.long_name;
      }
      if (comp.types.includes('locality') || comp.types.includes('administrative_area_level_2')) {
        city = comp.long_name;
      }
      if (comp.types.includes('administrative_area_level_1')) {
        state = comp.long_name;
      }
    }

    // Build a concise address label
    const streetParts = [streetNumber, route].filter(Boolean).join(' ');
    const addressLabel = streetParts || neighborhood || result.formatted_address.split(',')[0];

    return new Response(
      JSON.stringify({
        formatted_address: result.formatted_address,
        address_label: addressLabel,
        neighborhood,
        city,
        state,
        street_address: streetParts,
        latitude,
        longitude,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
