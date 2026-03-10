/// <reference types="google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Search, MapPin } from 'lucide-react';

interface MapLocationPickerProps {
  latitude?: number;
  longitude?: number;
  onLocationSelect: (lat: number, lng: number) => void;
  height?: string;
  markerColor?: string;
  showSearchBar?: boolean;
}

interface PlaceSuggestion {
  place_id: string;
  description: string;
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

export function MapLocationPicker({ latitude, longitude, onLocationSelect, height = '300px', markerColor, showSearchBar = false }: MapLocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

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

  // Handle search input changes - fetch suggestions via AutocompleteService
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!autocompleteServiceRef.current) return;

      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      }

      setSearchLoading(true);
      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: value,
          componentRestrictions: { country: 'ng' },
          sessionToken: sessionTokenRef.current,
        },
        (predictions, status) => {
          setSearchLoading(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(
              predictions.map((p) => ({
                place_id: p.place_id,
                description: p.description,
              }))
            );
            setShowSuggestions(true);
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        }
      );
    }, 300);
  }, []);

  // Handle suggestion selection - get place details and set marker
  const handleSelectSuggestion = useCallback((suggestion: PlaceSuggestion) => {
    if (!placesServiceRef.current) return;

    setSuggestions([]);
    setShowSuggestions(false);
    setSearchQuery(suggestion.description);
    setSearchLoading(true);

    placesServiceRef.current.getDetails(
      {
        placeId: suggestion.place_id,
        fields: ['geometry', 'name', 'formatted_address'],
        sessionToken: sessionTokenRef.current || undefined,
      },
      (place, status) => {
        setSearchLoading(false);
        // Reset session token after getDetails (ends the session)
        sessionTokenRef.current = null;

        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          mapInstanceRef.current?.setCenter({ lat, lng });
          mapInstanceRef.current?.setZoom(16);
          placeMarker(lat, lng);
          onLocationSelect(lat, lng);
        }
      }
    );
  }, [placeMarker, onLocationSelect]);

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

        // Initialize services for custom autocomplete
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        placesServiceRef.current = new google.maps.places.PlacesService(map);

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
      {showSearchBar && (
        <div className="absolute top-3 left-3 right-3 z-20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              onBlur={() => { setTimeout(() => setShowSuggestions(false), 200); }}
              placeholder="Search for a landmark or address..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="mt-1 bg-background border border-input rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.place_id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur from firing before click
                    handleSelectSuggestion(suggestion);
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted active:bg-muted transition-colors flex items-start gap-2 border-b border-border last:border-b-0"
                >
                  <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground">{suggestion.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
