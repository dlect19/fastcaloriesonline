import { supabase } from '@/integrations/supabase/client';

interface GeocodeResult {
  latitude: number;
  longitude: number;
  display_name: string;
}

export interface GeocodeSuggestion {
  latitude: number;
  longitude: number;
  display_name: string;
  name: string;
  city?: string;
  state?: string;
}

interface GeocodeResponse {
  result: GeocodeResult | null;
  suggestions: GeocodeSuggestion[];
}

/**
 * Geocode an address using the edge function (which uses Photon + Nominatim)
 * Returns both the result (if found) and suggestions (if not found or partial match)
 */
export async function geocodeAddressWithSuggestions(
  address: string,
  city?: string,
  state?: string
): Promise<GeocodeResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('geocode-address', {
      body: { address, city, state, country: 'Nigeria' },
    });

    if (error) {
      console.warn('Geocoding unavailable:', error);
      return { result: null, suggestions: [] };
    }

    // Check if we got a successful result
    if (data && !data.error && data.latitude && data.longitude) {
      return {
        result: {
          latitude: data.latitude,
          longitude: data.longitude,
          display_name: data.display_name,
        },
        suggestions: data.suggestions || [],
      };
    }

    // No exact match - return suggestions if available
    return {
      result: null,
      suggestions: data?.suggestions || [],
    };
  } catch (error) {
    console.error('Geocoding failed:', error);
    return { result: null, suggestions: [] };
  }
}

/**
 * Geocode an address using the edge function (which uses Photon + Nominatim)
 * Simple version that just returns coordinates or null
 */
export async function geocodeAddress(
  address: string,
  city?: string,
  state?: string
): Promise<GeocodeResult | null> {
  const { result } = await geocodeAddressWithSuggestions(address, city, state);
  return result;
}

/**
 * Update address with coordinates
 */
export async function updateAddressCoordinates(
  addressId: string,
  latitude: number,
  longitude: number
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('addresses')
      .update({ latitude, longitude })
      .eq('id', addressId);

    return !error;
  } catch (error) {
    console.error('Failed to update address coordinates:', error);
    return false;
  }
}

/**
 * Update vendor with coordinates
 */
export async function updateVendorCoordinates(
  vendorId: string,
  latitude: number,
  longitude: number
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('vendors')
      .update({ latitude, longitude })
      .eq('id', vendorId);

    return !error;
  } catch (error) {
    console.error('Failed to update vendor coordinates:', error);
    return false;
  }
}

interface GeocodeAndUpdateResult extends GeocodeResult {
  suggestions?: GeocodeSuggestion[];
}

/**
 * Geocode and update an address automatically
 * Returns result with suggestions if exact match not found
 */
export async function geocodeAndUpdateAddress(
  addressId: string,
  addressLine: string,
  city: string,
  state: string
): Promise<GeocodeAndUpdateResult | null> {
  const { result, suggestions } = await geocodeAddressWithSuggestions(addressLine, city, state);
  
  if (result) {
    await updateAddressCoordinates(addressId, result.latitude, result.longitude);
    return result;
  }
  
  // Return null but with suggestions attached for the caller to handle
  if (suggestions.length > 0) {
    return {
      latitude: 0,
      longitude: 0,
      display_name: '',
      suggestions,
    } as GeocodeAndUpdateResult;
  }
  
  return null;
}

/**
 * Geocode and update a vendor automatically
 */
export async function geocodeAndUpdateVendor(
  vendorId: string,
  address: string,
  city: string,
  state: string
): Promise<GeocodeResult | null> {
  const result = await geocodeAddress(address, city, state);
  
  if (result) {
    await updateVendorCoordinates(vendorId, result.latitude, result.longitude);
  }
  
  return result;
}
