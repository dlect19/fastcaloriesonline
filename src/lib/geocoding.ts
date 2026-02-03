import { supabase } from '@/integrations/supabase/client';

interface GeocodeResult {
  latitude: number;
  longitude: number;
  display_name: string;
}

/**
 * Geocode an address using the edge function (which uses Nominatim/OSM)
 */
export async function geocodeAddress(
  address: string,
  city?: string,
  state?: string
): Promise<GeocodeResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('geocode-address', {
      body: { address, city, state, country: 'Nigeria' },
    });

    // "not found" is a normal outcome for many informal/landmark addresses.
    // Treat it as a non-fatal null result (no console.error to avoid blank-screen error overlays).
    const notFound =
      data?.error === 'Address not found' ||
      data?.error === 'Location not found' ||
      data?.error === 'Address is required for forward geocoding';

    if (error || !data || data.error) {
      if (!notFound) {
        console.warn('Geocoding unavailable:', error || data?.error);
      }
      return null;
    }

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      display_name: data.display_name,
    };
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
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

/**
 * Geocode and update an address automatically
 */
export async function geocodeAndUpdateAddress(
  addressId: string,
  addressLine: string,
  city: string,
  state: string
): Promise<GeocodeResult | null> {
  const result = await geocodeAddress(addressLine, city, state);
  
  if (result) {
    await updateAddressCoordinates(addressId, result.latitude, result.longitude);
  }
  
  return result;
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
