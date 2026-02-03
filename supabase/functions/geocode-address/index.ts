const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

// Lagos bounding box for more accurate Nigerian address results
const LAGOS_VIEWBOX = '3.0,6.3,3.6,6.7'; // lon1,lat1,lon2,lat2

// Extract last N words from address (typically area names like "Ikosi Ketu")
function extractAreaName(address: string, wordCount: number = 2): string {
  const words = address.trim().split(/\s+/);
  return words.slice(-wordCount).join(' ');
}

// Try geocoding with a specific query
async function tryGeocode(query: string, useViewbox: boolean = false): Promise<any[]> {
  const encodedQuery = encodeURIComponent(query);
  let url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1&addressdetails=1`;
  
  if (useViewbox) {
    url += `&viewbox=${LAGOS_VIEWBOX}&bounded=1`;
  }
  
  console.log(`Trying geocode query: ${query}${useViewbox ? ' (with viewbox)' : ''}`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'FastCalories/1.0 (Food Delivery App)',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`Nominatim API error: ${response.status}`);
    return [];
  }

  return await response.json();
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
          // IMPORTANT: return 200 to avoid client-side crashes on non-2xx
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await response.json();

      if (!result || result.error) {
        console.log(`No results found for coordinates: ${latitude}, ${longitude}`);
        return new Response(
          JSON.stringify({ error: 'Location not found' }),
          // IMPORTANT: return 200 to avoid client-side crashes on non-2xx
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        // IMPORTANT: return 200 to avoid client-side crashes on non-2xx
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Forward geocoding: address="${address}", city="${city}", state="${state}"`);

    // Build search strategies - try multiple approaches for Nigerian addresses
    const searchStrategies: Array<{ query: string; useViewbox: boolean }> = [];
    
    // Strategy 1: Full query with city
    const fullQuery = [address, city, state, country].filter(Boolean).join(', ');
    searchStrategies.push({ query: fullQuery, useViewbox: false });
    
    // Strategy 2: Skip city (informal addresses often have wrong city)
    const noCityQuery = [address, state, country].filter(Boolean).join(', ');
    if (city && noCityQuery !== fullQuery) {
      searchStrategies.push({ query: noCityQuery, useViewbox: false });
    }
    
    // Strategy 3: Area name only with Lagos viewbox
    const areaName = extractAreaName(address, 2);
    if (areaName && areaName !== address) {
      searchStrategies.push({ query: `${areaName}, Lagos, Nigeria`, useViewbox: true });
    }
    
    // Strategy 4: Try area name with state
    if (areaName && state) {
      searchStrategies.push({ query: `${areaName}, ${state}, Nigeria`, useViewbox: false });
    }
    
    // Strategy 5: Last 3 words (for longer area names like "Ikosi Ketu Lagos")
    const longerAreaName = extractAreaName(address, 3);
    if (longerAreaName && longerAreaName !== areaName && longerAreaName !== address) {
      searchStrategies.push({ query: `${longerAreaName}, Nigeria`, useViewbox: true });
    }

    // Try each strategy until we get a result
    let results: any[] = [];
    let successfulQuery = '';
    
    for (const strategy of searchStrategies) {
      results = await tryGeocode(strategy.query, strategy.useViewbox);
      if (results && results.length > 0) {
        successfulQuery = strategy.query;
        console.log(`Found result with strategy: ${strategy.query}`);
        break;
      }
    }

    if (!results || results.length === 0) {
      console.log(`No results found after trying ${searchStrategies.length} strategies`);
      return new Response(
        JSON.stringify({ 
          error: 'Address not found', 
          query: fullQuery,
          strategies_tried: searchStrategies.length 
        }),
        // IMPORTANT: return 200 to avoid client-side crashes on non-2xx
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    console.log(`Geocoded successfully with "${successfulQuery}": ${geocodeResult.latitude}, ${geocodeResult.longitude}`);

    return new Response(
      JSON.stringify(geocodeResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Geocoding error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      // IMPORTANT: return 200 to avoid client-side crashes on non-2xx
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
