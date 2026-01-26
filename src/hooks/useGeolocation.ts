import { useState, useEffect, useCallback } from 'react';

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
  timeout: 10000,
  maximumAge: 60000, // Cache for 1 minute
  watch: false,
};

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const opts = { ...defaultOptions, ...options };
  
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    loading: false,
    error: null,
    timestamp: null,
  });

  const updatePosition = useCallback((position: GeolocationPosition) => {
    setState({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      loading: false,
      error: null,
      timestamp: position.timestamp,
    });
  }, []);

  const handleError = useCallback((error: GeolocationPositionError) => {
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
    
    setState(prev => ({
      ...prev,
      loading: false,
      error: errorMessage,
    }));
  }, []);

  const getCurrentPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Geolocation is not supported by your browser',
      }));
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      updatePosition,
      handleError,
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge,
      }
    );
  }, [opts.enableHighAccuracy, opts.timeout, opts.maximumAge, updatePosition, handleError]);

  // Watch position if enabled
  useEffect(() => {
    if (!opts.watch || !navigator.geolocation) return;

    setState(prev => ({ ...prev, loading: true }));

    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      handleError,
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [opts.watch, opts.enableHighAccuracy, opts.timeout, opts.maximumAge, updatePosition, handleError]);

  const refresh = useCallback(() => {
    getCurrentPosition();
  }, [getCurrentPosition]);

  return {
    ...state,
    getCurrentPosition,
    refresh,
    isSupported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
  };
}
