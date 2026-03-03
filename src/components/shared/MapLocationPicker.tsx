/// <reference types="google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface MapLocationPickerProps {
  latitude?: number;
  longitude?: number;
  onLocationSelect: (lat: number, lng: number) => void;
  height?: string;
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

export function MapLocationPicker({ latitude, longitude, onLocationSelect, height = '300px' }: MapLocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const defaultLat = latitude || 6.5244;
  const defaultLng = longitude || 3.3792;

  const placeMarker = useCallback((lat: number, lng: number) => {
    if (!mapInstanceRef.current) return;
    const position = { lat, lng };

    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      markerRef.current = new google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        draggable: true,
      });

      markerRef.current.addListener('dragend', () => {
        const pos = markerRef.current?.getPosition();
        if (pos) onLocationSelect(pos.lat(), pos.lng());
      });
    }
  }, [onLocationSelect]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.functions.invoke('get-google-maps-key');
        if (cancelled || !data?.key) { setError('Google Maps key not available'); setLoading(false); return; }

        await loadGoogleMaps(data.key);
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
      } catch {
        if (!cancelled) { setError('Failed to load map'); setLoading(false); }
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
