import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from './useGeolocation';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

export interface VendorWithDistance extends Vendor {
  distance: number;
  dynamic_delivery_fee: number;
  outlet_id?: string;
  outlet_name?: string;
  outlet_surname?: string;
  display_name?: string;
}

interface UseLocationBasedVendorsOptions {
  category?: string;
  externalLat?: number | null;
  externalLon?: number | null;
  addressState?: string | null;
  enabled?: boolean;
}

interface VendorAccessResult {
  success: boolean;
  vendor: VendorWithDistance | null;
  error?: string;
  message?: string;
  distance?: number;
  max_radius?: number;
}

export function useLocationBasedVendors({
  category = 'all',
  externalLat,
  externalLon,
  addressState,
  enabled = true,
}: UseLocationBasedVendorsOptions = {}) {
  const [vendors, setVendors] = useState<VendorWithDistance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noLocationError, setNoLocationError] = useState(false);
  const [maxRadius, setMaxRadius] = useState<number>(10);

  const {
    latitude: gpsLat,
    longitude: gpsLon,
    loading: geoLoading,
    error: geoError,
    getCurrentPosition,
  } = useGeolocation();

  // Use external location if provided, otherwise fall back to GPS
  const latitude = externalLat ?? gpsLat;
  const longitude = externalLon ?? gpsLon;
  const hasLocation = latitude !== null && longitude !== null;

  const fetchVendors = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);
    setNoLocationError(false);

    // If no location available, show error state
    if (!hasLocation) {
      setNoLocationError(true);
      setVendors([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('get-nearby-vendors', {
        body: {
          customer_lat: latitude,
          customer_lon: longitude,
          category: category === 'all' ? null : category,
          customer_state: addressState || null,
        },
      });

      if (invokeError) {
        console.error('Error invoking get-nearby-vendors:', invokeError);
        setError('Failed to load vendors');
        setVendors([]);
        return;
      }

      if (!data.success) {
        if (data.error === 'customer_location_required') {
          setNoLocationError(true);
        } else {
          setError(data.message || 'Failed to load vendors');
        }
        setVendors([]);
        return;
      }

      setVendors(data.vendors || []);
      setMaxRadius(data.max_radius_km || 10);
    } catch (err) {
      console.error('Error fetching nearby vendors:', err);
      setError('Failed to load vendors');
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude, category, hasLocation, enabled, addressState]);

  // Fetch vendors when location or category changes
  useEffect(() => {
    if (!geoLoading) {
      fetchVendors();
    }
  }, [fetchVendors, geoLoading]);

  // Request location on mount if no external location provided
  useEffect(() => {
    if (externalLat === undefined || externalLat === null) {
      getCurrentPosition();
    }
  }, [externalLat, getCurrentPosition]);

  return {
    vendors,
    loading: loading || geoLoading,
    error,
    noLocationError,
    geoError,
    hasLocation,
    maxRadius,
    refetch: fetchVendors,
    requestLocation: getCurrentPosition,
  };
}

/**
 * Check if a specific vendor is accessible from a given location
 * Used for direct URL access, QR codes, and search results
 */
export async function checkVendorAccess(
  vendorId: string,
  customerLat: number | null,
  customerLon: number | null,
  outletId?: string
): Promise<VendorAccessResult> {
  // If no location, deny access
  if (customerLat === null || customerLon === null) {
    return {
      success: false,
      vendor: null,
      error: 'location_required',
      message: 'Please enable location access to view this vendor',
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('get-nearby-vendors', {
      body: {
        customer_lat: customerLat,
        customer_lon: customerLon,
        vendor_id: vendorId,
        outlet_id: outletId,
      },
    });

    if (error) {
      console.error('Error checking vendor access:', error);
      return {
        success: false,
        vendor: null,
        error: 'network_error',
        message: 'Failed to verify vendor availability',
      };
    }

    if (!data.success) {
      return {
        success: false,
        vendor: null,
        error: data.error,
        message: data.message,
        distance: data.distance,
        max_radius: data.max_radius,
      };
    }

    return {
      success: true,
      vendor: data.vendor,
    };
  } catch (err) {
    console.error('Error checking vendor access:', err);
    return {
      success: false,
      vendor: null,
      error: 'unknown_error',
      message: 'Something went wrong. Please try again.',
    };
  }
}
