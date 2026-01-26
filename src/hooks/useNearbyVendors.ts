import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateDistance, sortByDistance } from '@/lib/location';
import { useDeliverySettings } from './useDeliverySettings';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

interface VendorWithDistance extends Vendor {
  distance: number;
}

interface UseNearbyVendorsOptions {
  userLat: number | null;
  userLon: number | null;
  category?: string;
  maxRadius?: number;
}

export function useNearbyVendors({ userLat, userLon, category, maxRadius }: UseNearbyVendorsOptions) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useDeliverySettings();

  const effectiveRadius = maxRadius ?? settings.vendorDeliveryRadiusKm;

  useEffect(() => {
    fetchVendors();
  }, [category]);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('vendors')
        .select('*')
        .eq('is_active', true)
        .order('rating', { ascending: false });

      if (category && category !== 'all' && ['restaurant', 'pharmacy', 'market'].includes(category)) {
        query = query.eq('category', category as 'restaurant' | 'pharmacy' | 'market');
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setVendors(data || []);
    } catch (err) {
      console.error('Error fetching vendors:', err);
      setError('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort vendors by distance
  const nearbyVendors = useMemo((): VendorWithDistance[] => {
    if (!userLat || !userLon) {
      // If no user location, return vendors without distance filtering
      return vendors.map(v => ({
        ...v,
        distance: v.latitude && v.longitude
          ? calculateDistance(userLat || 0, userLon || 0, v.latitude, v.longitude)
          : Infinity,
      }));
    }

    // Filter vendors with coordinates within radius
    return vendors
      .filter(v => {
        if (!v.latitude || !v.longitude) return true; // Include vendors without coords
        const distance = calculateDistance(userLat, userLon, v.latitude, v.longitude);
        return distance <= effectiveRadius;
      })
      .map(v => ({
        ...v,
        distance: v.latitude && v.longitude
          ? calculateDistance(userLat, userLon, v.latitude, v.longitude)
          : Infinity,
      }))
      .sort((a, b) => {
        // Sort by: open status first, then distance
        if (a.is_active !== b.is_active) {
          return a.is_active ? -1 : 1;
        }
        return a.distance - b.distance;
      });
  }, [vendors, userLat, userLon, effectiveRadius]);

  return {
    vendors: nearbyVendors,
    loading,
    error,
    refetch: fetchVendors,
    hasLocation: userLat !== null && userLon !== null,
  };
}
