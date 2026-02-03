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

interface GeocodeSuggestion {
  latitude: number;
  longitude: number;
  display_name: string;
  name: string;
  city?: string;
  state?: string;
}

// Lagos center coordinates for location bias
const LAGOS_CENTER = { lat: 6.5, lon: 3.4 };
const LAGOS_VIEWBOX = '3.0,6.3,3.6,6.7';

// ============= PHOTON GEOCODER (PRIMARY) =============
interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    city?: string;
    county?: string;
    locality?: string;
    district?: string;
    state?: string;
    country?: string;
  };
  geometry: {
    coordinates: [number, number]; // [lon, lat]
  };
}

function scorePhotonResult(feature: PhotonFeature, originalAddress: string): number {
  let score = 0;
  const props = feature.properties;
  const addressLower = originalAddress.toLowerCase();
  const addressWords = addressLower.split(/[\s,]+/).filter(w => w.length > 2);
  
  const propsText = [
    props.name, props.street, props.city, props.county, 
    props.locality, props.district
  ].filter(Boolean).join(' ').toLowerCase();
  
  for (const word of addressWords) {
    if (propsText.includes(word)) {
      score += 10;
    }
  }
  
  if (props.state?.toLowerCase().includes('lagos')) {
    score += 5;
  }
  
  if (props.country?.toLowerCase().includes('nigeria')) {
    score += 3;
  }
  
  return score;
}

function photonFeatureToSuggestion(feature: PhotonFeature): GeocodeSuggestion {
  const longitude = feature.geometry.coordinates[0];
  const latitude = feature.geometry.coordinates[1];
  const city = feature.properties.city || feature.properties.county || feature.properties.locality || feature.properties.district || '';
  const state = feature.properties.state || '';
  
  const displayName = [
    feature.properties.name,
    feature.properties.street,
    city,
    state
  ].filter(Boolean).join(', ');
  
  return {
    latitude,
    longitude,
    display_name: displayName,
    name: feature.properties.name || feature.properties.street || city,
    city,
    state,
  };
}

interface PhotonResult {
  result: GeocodeResult | null;
  suggestions: GeocodeSuggestion[];
}

async function tryPhotonGeocode(query: string, originalAddress: string, useBias: boolean = true): Promise<PhotonResult> {
  try {
    const encodedQuery = encodeURIComponent(query);
    let url = `https://photon.komoot.io/api?q=${encodedQuery}&limit=10`;
    
    if (useBias) {
      url += `&lat=${LAGOS_CENTER.lat}&lon=${LAGOS_CENTER.lon}`;
    }
    
    console.log(`Photon query${useBias ? ' (with Lagos bias)' : ''}: ${query}`);
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FastCalories/1.0 (Food Delivery App)' }
    });
    
    if (!response.ok) {
      console.error(`Photon API error: ${response.status}`);
      return { result: null, suggestions: [] };
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      console.log('Photon: No results found');
      return { result: null, suggestions: [] };
    }
    
    // Filter to Lagos State results first
    const lagosResults = data.features.filter((f: PhotonFeature) => 
      f.properties.state?.toLowerCase().includes('lagos')
    );
    
    // Score each result
    const candidates = (lagosResults.length > 0 ? lagosResults : data.features) as PhotonFeature[];
    const scoredResults = candidates.map((f: PhotonFeature) => ({
      feature: f,
      score: scorePhotonResult(f, originalAddress)
    }));
    
    scoredResults.sort((a, b) => b.score - a.score);
    
    // Generate suggestions from top results (for when exact match fails)
    const suggestions = scoredResults
      .slice(0, 5)
      .map(sr => photonFeatureToSuggestion(sr.feature));
    
    // Take best match, but require minimum score
    const bestMatch = scoredResults[0];
    if (bestMatch.score < 5) {
      console.log(`Photon: Best match score too low (${bestMatch.score}), returning suggestions instead`);
      return { result: null, suggestions };
    }
    
    const result = bestMatch.feature;
    const longitude = result.geometry.coordinates[0];
    const latitude = result.geometry.coordinates[1];
    
    const city = result.properties.city || result.properties.county || result.properties.locality || result.properties.district || '';
    const state = result.properties.state || '';
    
    const displayName = [
      result.properties.name,
      result.properties.street,
      city,
      state
    ].filter(Boolean).join(', ');
    
    console.log(`Photon found (score ${bestMatch.score}): ${displayName} at ${latitude}, ${longitude}`);
    
    return {
      result: {
        latitude,
        longitude,
        display_name: displayName,
        confidence: Math.min(0.5 + (bestMatch.score / 40), 0.95),
        city,
        state,
      },
      suggestions
    };
  } catch (error) {
    console.error('Photon geocoding error:', error);
    return { result: null, suggestions: [] };
  }
}

// ============= NOMINATIM GEOCODER (FALLBACK) =============
function extractAreaName(address: string, wordCount: number = 2): string {
  const words = address.trim().split(/\s+/);
  return words.slice(-wordCount).join(' ');
}

async function tryNominatimGeocode(query: string, useViewbox: boolean = false): Promise<any[]> {
  const encodedQuery = encodeURIComponent(query);
  let url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1&addressdetails=1`;
  
  if (useViewbox) {
    url += `&viewbox=${LAGOS_VIEWBOX}&bounded=1`;
  }
  
  console.log(`Nominatim query: ${query}${useViewbox ? ' (with viewbox)' : ''}`);
  
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

async function geocodeWithNominatim(address: string, city: string, state: string, country: string): Promise<GeocodeResult | null> {
  const searchStrategies: Array<{ query: string; useViewbox: boolean }> = [];
  
  const fullQuery = [address, city, state, country].filter(Boolean).join(', ');
  searchStrategies.push({ query: fullQuery, useViewbox: false });
  
  const noCityQuery = [address, state, country].filter(Boolean).join(', ');
  if (city && noCityQuery !== fullQuery) {
    searchStrategies.push({ query: noCityQuery, useViewbox: false });
  }
  
  const areaName = extractAreaName(address, 2);
  if (areaName && areaName !== address) {
    searchStrategies.push({ query: `${areaName}, Lagos, Nigeria`, useViewbox: true });
  }
  
  if (areaName && state) {
    searchStrategies.push({ query: `${areaName}, ${state}, Nigeria`, useViewbox: false });
  }
  
  const longerAreaName = extractAreaName(address, 3);
  if (longerAreaName && longerAreaName !== areaName && longerAreaName !== address) {
    searchStrategies.push({ query: `${longerAreaName}, Nigeria`, useViewbox: true });
  }

  for (const strategy of searchStrategies) {
    const results = await tryNominatimGeocode(strategy.query, strategy.useViewbox);
    if (results && results.length > 0) {
      const result = results[0];
      const addressDetails = result.address || {};
      
      console.log(`Nominatim found with strategy: ${strategy.query}`);
      
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        display_name: result.display_name,
        confidence: parseFloat(result.importance || 0.5),
        city: addressDetails.city || addressDetails.town || addressDetails.village || '',
        state: addressDetails.state || '',
      };
    }
  }
  
  return null;
}

// ============= REVERSE GEOCODING =============
async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
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
    return null;
  }

  const result = await response.json();

  if (!result || result.error) {
    console.log(`No reverse geocoding results for: ${latitude}, ${longitude}`);
    return null;
  }

  const addressDetails = result.address || {};
  const resultCity = addressDetails.city || addressDetails.town || addressDetails.village || addressDetails.suburb || addressDetails.county || '';
  const resultState = addressDetails.state || '';

  console.log(`Reverse geocoded: city=${resultCity}, state=${resultState}`);

  return {
    latitude,
    longitude,
    display_name: result.display_name,
    city: resultCity,
    state: resultState,
    confidence: 1.0,
  };
}

// ============= MAIN HANDLER =============
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, city, state, country = 'Nigeria', latitude, longitude, reverse }: GeocodeRequest = await req.json();

    // Handle reverse geocoding
    if (reverse && latitude !== undefined && longitude !== undefined) {
      const result = await reverseGeocode(latitude, longitude);
      
      if (!result) {
        return new Response(
          JSON.stringify({ error: 'Location not found' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Forward geocoding
    if (!address) {
      return new Response(
        JSON.stringify({ error: 'Address is required for forward geocoding' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Forward geocoding: address="${address}", city="${city}", state="${state}"`);

    // Build query variations
    const photonQueries = [
      `${address} Lagos`,
      [address, state, country].filter(Boolean).join(' '),
      [address, city, state, country].filter(Boolean).join(' '),
    ];
    
    const uniqueQueries = [...new Set(photonQueries)];
    
    // Collect all suggestions across attempts
    let allSuggestions: GeocodeSuggestion[] = [];

    // Strategy 1-3: Try Photon with different query formulations
    for (const query of uniqueQueries) {
      const { result, suggestions } = await tryPhotonGeocode(query, address, true);
      allSuggestions = [...allSuggestions, ...suggestions];
      if (result) {
        return new Response(
          JSON.stringify(result),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Strategy 4: Try Photon without Lagos bias
    for (const query of uniqueQueries) {
      const { result, suggestions } = await tryPhotonGeocode(query, address, false);
      allSuggestions = [...allSuggestions, ...suggestions];
      if (result) {
        return new Response(
          JSON.stringify(result),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Strategy 5: If no suggestions yet, try extracting just neighborhood/area names
    // This helps when the full address is too specific (e.g., "2 jamiu balogun ikosi ketu")
    if (allSuggestions.length === 0) {
      const words = address.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);
      
      // Try last 2-3 words (often the neighborhood name like "ikosi ketu")
      const areaQueries = [];
      if (words.length >= 2) {
        areaQueries.push(words.slice(-2).join(' ') + ' Lagos');
      }
      if (words.length >= 3) {
        areaQueries.push(words.slice(-3).join(' ') + ' Lagos');
      }
      // Also try just the area name without street numbers
      const areaOnly = words.filter(w => !/^\d+/.test(w)).join(' ');
      if (areaOnly && areaOnly !== address.toLowerCase()) {
        areaQueries.push(areaOnly + ' Lagos');
      }
      
      console.log(`Trying area-only queries for suggestions: ${areaQueries.join(', ')}`);
      
      for (const query of areaQueries) {
        const { result, suggestions } = await tryPhotonGeocode(query, address, true);
        allSuggestions = [...allSuggestions, ...suggestions];
        // Don't return result here - these are fallback suggestions, not exact matches
        if (suggestions.length > 0) break;
      }
    }

    // Strategy 5: Fall back to Nominatim
    const nominatimResult = await geocodeWithNominatim(address, city || '', state || '', country);
    if (nominatimResult) {
      return new Response(
        JSON.stringify(nominatimResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate suggestions by coordinates (round to 4 decimals)
    const seenCoords = new Set<string>();
    const uniqueSuggestions = allSuggestions.filter(s => {
      const key = `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`;
      if (seenCoords.has(key)) return false;
      seenCoords.add(key);
      return true;
    }).slice(0, 5);

    // No exact match found - return suggestions if available
    console.log(`No exact match found. Returning ${uniqueSuggestions.length} suggestions.`);
    
    return new Response(
      JSON.stringify({ 
        error: 'Address not found', 
        query: address,
        suggestions: uniqueSuggestions,
        strategies_tried: 'photon_multiple_queries, nominatim_5_strategies'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Geocoding error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
