import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from './useGeolocation';

interface UseRiderLocationOptions {
  riderId?: string;
  updateInterval?: number; // milliseconds
  enabled?: boolean;
}

export function useRiderLocation({ 
  riderId, 
  updateInterval = 30000, // Update every 30 seconds
  enabled = true 
}: UseRiderLocationOptions = {}) {
  const [updating, setUpdating] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { 
    latitude, 
    longitude, 
    accuracy, 
    loading: geoLoading, 
    error: geoError,
    getCurrentPosition 
  } = useGeolocation({ enableHighAccuracy: true });

  // Update rider location in database
  const updateLocation = useCallback(async () => {
    if (!riderId || !latitude || !longitude) return;

    setUpdating(true);
    try {
      const { error: updateError } = await supabase
        .from('rider_profiles')
        .update({
          current_latitude: latitude,
          current_longitude: longitude,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', riderId);

      if (updateError) throw updateError;

      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error('Error updating rider location:', err);
      setError('Failed to update location');
    } finally {
      setUpdating(false);
    }
  }, [riderId, latitude, longitude]);

  // Periodic location updates
  useEffect(() => {
    if (!enabled || !riderId) return;

    // Get initial position
    getCurrentPosition();

    // Set up periodic updates
    const intervalId = setInterval(() => {
      getCurrentPosition();
    }, updateInterval);

    return () => clearInterval(intervalId);
  }, [enabled, riderId, updateInterval, getCurrentPosition]);

  // Update database when location changes
  useEffect(() => {
    if (latitude && longitude && riderId && enabled) {
      updateLocation();
    }
  }, [latitude, longitude, riderId, enabled, updateLocation]);

  return {
    latitude,
    longitude,
    accuracy,
    loading: geoLoading || updating,
    error: geoError || error,
    lastUpdate,
    forceUpdate: () => {
      getCurrentPosition();
      updateLocation();
    },
  };
}

// Hook to subscribe to a rider's location updates
export function useRiderLocationSubscription(riderProfileId: string | null) {
  const [location, setLocation] = useState<{
    latitude: number | null;
    longitude: number | null;
    updatedAt: string | null;
  }>({
    latitude: null,
    longitude: null,
    updatedAt: null,
  });

  useEffect(() => {
    if (!riderProfileId) return;

    // Fetch initial location
    const fetchInitial = async () => {
      const { data } = await supabase
        .from('rider_profiles')
        .select('current_latitude, current_longitude, updated_at')
        .eq('id', riderProfileId)
        .single();

      if (data) {
        setLocation({
          latitude: data.current_latitude,
          longitude: data.current_longitude,
          updatedAt: data.updated_at,
        });
      }
    };

    fetchInitial();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`rider-location-${riderProfileId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rider_profiles',
          filter: `id=eq.${riderProfileId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          setLocation({
            latitude: newData.current_latitude,
            longitude: newData.current_longitude,
            updatedAt: newData.updated_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderProfileId]);

  return location;
}
