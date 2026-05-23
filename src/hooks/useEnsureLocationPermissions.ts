/**
 * useEnsureLocationPermissions
 *
 * Google Play compliant location flow for the rider app. On native Android,
 * this defers to the custom RiderServicePlugin which first shows our
 * Prominent Disclosure dialog and THEN requests the OS permission. Only after
 * 'granted' do we start the tracking foreground service.
 *
 * On web, falls back to the browser Geolocation prompt.
 */

import { useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import RiderServicePlugin from '@/plugins/RiderServicePlugin';

export type LocationPermissionStatus = 'granted' | 'denied' | 'unknown';

export function useEnsureLocationPermissions() {
  const [status, setStatus] = useState<LocationPermissionStatus>('unknown');
  const [checking, setChecking] = useState(false);

  const ensureLocationPermissions = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const { status: result } = await RiderServicePlugin.requestLocationWithDisclosure();
      setStatus(result);

      if (result === 'granted') {
        try {
          await RiderServicePlugin.startService();
        } catch (err) {
          console.error('[ensureLocationPermissions] startService failed', err);
        }
        return true;
      }

      toast({
        title: 'Location access required',
        description:
          'Fast Calories needs your location — even in the background — to receive nearby delivery orders, navigate to pickups, and keep customers updated. Please enable location access to go online.',
        variant: 'destructive',
      });
      return false;
    } catch (err) {
      console.error('[ensureLocationPermissions] failed', err);
      setStatus('denied');
      toast({
        title: 'Could not request location',
        description: 'Something went wrong while requesting location permission. Please try again.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  const stopLocationService = useCallback(async () => {
    try {
      await RiderServicePlugin.stopService();
    } catch (err) {
      console.error('[ensureLocationPermissions] stopService failed', err);
    }
  }, []);

  return {
    status,
    checking,
    isNative: Capacitor.isNativePlatform(),
    ensureLocationPermissions,
    stopLocationService,
  };
}
