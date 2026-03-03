import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const { place_id, sessionToken } = await req.json();

    if (!place_id) {
      return new Response(
        JSON.stringify({ error: 'place_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params = new URLSearchParams({
      place_id,
      key: apiKey,
      fields: 'geometry,formatted_address,address_components,name',
    });

    if (sessionToken) {
      params.set('sessiontoken', sessionToken);
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      console.error('Place Details error:', data.status, data.error_message);
      return new Response(
        JSON.stringify({ error: data.error_message || data.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = data.result;
    const location = result.geometry?.location;

    // Extract address components
    const components = result.address_components || [];
    let city = '';
    let state = '';
    let streetAddress = '';

    for (const comp of components) {
      if (comp.types.includes('administrative_area_level_2') || comp.types.includes('locality')) {
        city = comp.long_name;
      }
      if (comp.types.includes('administrative_area_level_1')) {
        state = comp.long_name;
      }
      if (comp.types.includes('route')) {
        streetAddress = comp.long_name;
      }
    }

    return new Response(
      JSON.stringify({
        latitude: location?.lat,
        longitude: location?.lng,
        formatted_address: result.formatted_address,
        name: result.name,
        city,
        state,
        street_address: streetAddress,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Place details error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
