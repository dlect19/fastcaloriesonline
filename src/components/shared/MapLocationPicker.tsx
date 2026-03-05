/// <reference types="google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';

import { Loader2 } from 'lucide-react';

interface MapLocationPickerProps {
  latitude?: number;
  longitude?: number;
  onLocationSelect: (lat: number, lng: number) => void;
  height?: string;
  markerColor?: string;
}

let googleMapsPromise: Promise<void> | null = null;
let googleMapsLoaded = false;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => { googleMapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

export function MapLocationPicker({ latitude, longitude, onLocationSelect, height = '300px', markerColor }: MapLocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const defaultLat = latitude || 6.5244;
  const defaultLng = longitude || 3.3792;

  const createMarkerIcon = useCallback(() => {
    if (!markerColor) return undefined;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="${markerColor}"/>
      <circle cx="18" cy="18" r="7" fill="white"/>
    </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(36, 48),
      anchor: new google.maps.Point(18, 48),
    };
  }, [markerColor]);

  const placeMarker = useCallback((lat: number, lng: number) => {
    if (!mapInstanceRef.current) return;
    const position = { lat, lng };
    const icon = createMarkerIcon();

    if (markerRef.current) {
      markerRef.current.setPosition(position);
      if (icon) markerRef.current.setIcon(icon);
    } else {
      markerRef.current = new google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        draggable: true,
        ...(icon ? { icon } : {}),
      });

      markerRef.current.addListener('dragend', () => {
        const pos = markerRef.current?.getPosition();
        if (pos) onLocationSelect(pos.lat(), pos.lng());
      });
    }
  }, [onLocationSelect, createMarkerIcon]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        
        const response = await fetch(`${supabaseUrl}/functions/v1/get-google-maps-key`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey': supabaseAnonKey,
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          console.error('Maps key fetch failed:', response.status, response.statusText);
          if (!cancelled) { setError('Failed to fetch API key'); setLoading(false); }
          return;
        }
        
        const data = await response.json();
        console.log('Maps key response:', data);
        const apiKey = data?.key;
        
        if (!apiKey) {
          console.error('No API key in response:', data);
          if (!cancelled) { setError('API key not configured'); setLoading(false); }
          return;
        }
        
        if (cancelled) return;

        await loadGoogleMaps(apiKey);
        if (cancelled || !mapRef.current) return;

        const center = { lat: defaultLat, lng: defaultLng };
        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: latitude ? 16 : 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapInstanceRef.current = map;

        if (latitude && longitude) {
          placeMarker(latitude, longitude);
        }

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          placeMarker(lat, lng);
          onLocationSelect(lat, lng);
        });

        setLoading(false);
      } catch (err) {
        console.error('Map init error:', err);
        if (!cancelled) { setError('Failed to load Google Maps script'); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update marker when coordinates change externally
  useEffect(() => {
    if (mapInstanceRef.current && latitude && longitude) {
      placeMarker(latitude, longitude);
      mapInstanceRef.current.panTo({ lat: latitude, lng: longitude });
    }
  }, [latitude, longitude, placeMarker]);

  if (error) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-muted/50 text-sm text-muted-foreground" style={{ height }}>
        {error}
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border" style={{ height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
