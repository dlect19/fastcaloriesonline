import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GeocodeRequest {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  // For reverse geocoding
  latitude?: number;
  longitude?: number;
  reverse?: boolean;
}

interface GeocodeResult {
  latitude: number;
  longitude: number;
  display_name: string;
  confidence: number;
  city?: string;
  state?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, city, state, country = 'Nigeria', latitude, longitude, reverse }: GeocodeRequest = await req.json();

    // Handle reverse geocoding (coordinates → address)
    if (reverse && latitude !== undefined && longitude !== undefined) {
      console.log(`Reverse geocoding: ${latitude}, ${longitude}`);
      
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
      
      const response = await fetch(reverseUrl, {
        headers: {
          'User-Agent': 'FastCalories/1.0 (Food Delivery App)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Nominatim reverse API error: ${response.status}`);
        return new Response(
          JSON.stringify({ error: 'Reverse geocoding service unavailable' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await response.json();

      if (!result || result.error) {
        console.log(`No results found for coordinates: ${latitude}, ${longitude}`);
        return new Response(
          JSON.stringify({ error: 'Location not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const addressDetails = result.address || {};
      const resultCity = addressDetails.city || addressDetails.town || addressDetails.village || addressDetails.suburb || addressDetails.county || '';
      const resultState = addressDetails.state || '';

      console.log(`Reverse geocoded: city=${resultCity}, state=${resultState}`);

      return new Response(
        JSON.stringify({
          latitude,
          longitude,
          display_name: result.display_name,
          city: resultCity,
          state: resultState,
          confidence: 1.0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Forward geocoding (address → coordinates)
    if (!address) {
      return new Response(
        JSON.stringify({ error: 'Address is required for forward geocoding' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build full address query
    const queryParts = [address];
    if (city) queryParts.push(city);
    if (state) queryParts.push(state);
    queryParts.push(country);
    
    const query = queryParts.join(', ');
    const encodedQuery = encodeURIComponent(query);

    console.log(`Geocoding address: ${query}`);

    // Use Nominatim (OpenStreetMap) for geocoding - free and no API key needed
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1&addressdetails=1`;
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'FastCalories/1.0 (Food Delivery App)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Nominatim API error: ${response.status}`);
      return new Response(
        JSON.stringify({ error: 'Geocoding service unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      console.log(`No results found for: ${query}`);
      return new Response(
        JSON.stringify({ error: 'Address not found', query }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = results[0];
    const addressDetails = result.address || {};
    const geocodeResult: GeocodeResult = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      display_name: result.display_name,
      confidence: parseFloat(result.importance || 0.5),
      city: addressDetails.city || addressDetails.town || addressDetails.village || '',
      state: addressDetails.state || '',
    };

    console.log(`Geocoded successfully: ${geocodeResult.latitude}, ${geocodeResult.longitude}`);

    return new Response(
      JSON.stringify(geocodeResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Geocoding error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
