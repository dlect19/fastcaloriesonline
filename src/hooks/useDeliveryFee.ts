import { useState, useEffect, useMemo } from 'react';
import { calculateDeliveryFee } from '@/lib/location';
import { useDeliverySettings } from './useDeliverySettings';

interface UseDeliveryFeeOptions {
  vendorLat: number | null;
  vendorLon: number | null;
  customerLat: number | null;
  customerLon: number | null;
}

export function useDeliveryFee({ vendorLat, vendorLon, customerLat, customerLon }: UseDeliveryFeeOptions) {
  const { settings, loading: settingsLoading } = useDeliverySettings();
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  // Calculate distance when coordinates are available
  useEffect(() => {
    if (vendorLat && vendorLon && customerLat && customerLon) {
      // Haversine calculation
      const R = 6371;
      const dLat = (customerLat - vendorLat) * Math.PI / 180;
      const dLon = (customerLon - vendorLon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(vendorLat * Math.PI / 180) * Math.cos(customerLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      setDistanceKm(R * c);
    } else {
      setDistanceKm(null);
    }
  }, [vendorLat, vendorLon, customerLat, customerLon]);

  const fee = useMemo(() => {
    if (distanceKm === null || settingsLoading) {
      return settings.baseDeliveryFee; // Default fee
    }

    return calculateDeliveryFee(
      distanceKm,
      settings.baseDeliveryFee,
      settings.baseDeliveryDistanceKm,
      settings.perKmFee
    );
  }, [distanceKm, settings, settingsLoading]);

  const isOutOfRange = useMemo(() => {
    if (distanceKm === null) return false;
    return distanceKm > settings.maxDeliveryDistanceKm;
  }, [distanceKm, settings.maxDeliveryDistanceKm]);

  return {
    fee,
    distanceKm,
    isOutOfRange,
    loading: settingsLoading,
    hasCoordinates: vendorLat !== null && vendorLon !== null && customerLat !== null && customerLon !== null,
  };
}
