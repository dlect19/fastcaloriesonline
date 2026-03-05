import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
  timestamp: number | null;
}

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  watch?: boolean;
}

const defaultOptions: UseGeolocationOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 60000,
  watch: false,
};

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const opts = { ...defaultOptions, ...options };
  const isNative = Capacitor.isNativePlatform();
  
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    loading: false,
    error: null,
    timestamp: null,
  });

  const updatePosition = useCallback((lat: number, lon: number, accuracy: number | null, ts: number) => {
    setState({
      latitude: lat,
      longitude: lon,
      accuracy,
      loading: false,
      error: null,
      timestamp: ts,
    });
  }, []);

  const handleError = useCallback((errorMessage: string) => {
    setState(prev => ({
      ...prev,
      loading: false,
      error: errorMessage,
    }));
  }, []);

  const getCurrentPosition = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    if (isNative) {
      // Use Capacitor native GPS — accesses the actual device GPS chip
      try {
        // Request permissions first on native
        const permStatus = await Geolocation.checkPermissions();
        if (permStatus.location === 'denied') {
          const requestResult = await Geolocation.requestPermissions();
          if (requestResult.location === 'denied') {
            handleError('Location permission denied. Please enable location access in your device settings.');
            return;
          }
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeout,
          maximumAge: opts.maximumAge,
        });

        updatePosition(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
          position.timestamp,
        );
      } catch (err: any) {
        console.error('Capacitor Geolocation error:', err);
        handleError(err?.message || 'Unable to get your location from device GPS');
      }
    } else {
      // Fallback to browser geolocation API
      if (!navigator.geolocation) {
        handleError('Geolocation is not supported by your browser');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          updatePosition(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy,
            position.timestamp,
          );
        },
        (error) => {
          let errorMessage = 'Unable to get your location';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Please enable location access.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out.';
              break;
          }
          handleError(errorMessage);
        },
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeout,
          maximumAge: opts.maximumAge,
        }
      );
    }
  }, [isNative, opts.enableHighAccuracy, opts.timeout, opts.maximumAge, updatePosition, handleError]);

  // Watch position if enabled
  useEffect(() => {
    if (!opts.watch) return;

    setState(prev => ({ ...prev, loading: true }));

    if (isNative) {
      let watchId: string | null = null;
      
      Geolocation.watchPosition(
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeout,
          maximumAge: opts.maximumAge,
        },
        (position, err) => {
          if (err) {
            handleError(err.message || 'Watch position error');
            return;
          }
          if (position) {
            updatePosition(
              position.coords.latitude,
              position.coords.longitude,
              position.coords.accuracy,
              position.timestamp,
            );
          }
        }
      ).then(id => { watchId = id; });

      return () => {
        if (watchId) {
          Geolocation.clearWatch({ id: watchId });
        }
      };
    } else {
      if (!navigator.geolocation) return;

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          updatePosition(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy,
            position.timestamp,
          );
        },
        (error) => {
          handleError(error.message || 'Watch position error');
        },
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeout,
          maximumAge: opts.maximumAge,
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [opts.watch, isNative, opts.enableHighAccuracy, opts.timeout, opts.maximumAge, updatePosition, handleError]);

  const refresh = useCallback(() => {
    getCurrentPosition();
  }, [getCurrentPosition]);

  return {
    ...state,
    getCurrentPosition,
    refresh,
    isSupported: isNative || (typeof navigator !== 'undefined' && 'geolocation' in navigator),
  };
}
