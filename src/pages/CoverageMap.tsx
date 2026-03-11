import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2, AlertCircle, Search, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BottomNav } from '@/components/home/BottomNav';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import type { Json } from '@/integrations/supabase/types';

interface CoverageArea {
  id: string;
  name: string;
  color: string;
  polygon: Json;
  is_active: boolean;
}

interface SearchSuggestion {
  place_id: string;
  description: string;
}

export default function CoverageMap() {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const { latitude, longitude, getCurrentPosition } = useGeolocation();

  // Fetch coverage areas
  useEffect(() => {
    const fetchAreas = async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('coverage_areas')
          .select('id, name, color, polygon, is_active')
          .eq('is_active', true);

        if (fetchErr) throw fetchErr;
        setCoverageAreas(data || []);
      } catch (err) {
        console.error('Error fetching coverage areas:', err);
        setError('Failed to load coverage areas');
      } finally {
        setLoading(false);
      }
    };
    fetchAreas();
    getCurrentPosition();
  }, []);

  // Init map
  useEffect(() => {
    if (loading) return;

    const initMap = async () => {
      try {
        if (!window.google?.maps) {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          const response = await fetch(`${supabaseUrl}/functions/v1/get-google-maps-key`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseAnonKey}`, 'apikey': supabaseAnonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const keyData = await response.json();
          if (!keyData?.key) { setError('Map unavailable'); setMapLoading(false); return; }

          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${keyData.key}&libraries=places`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load map'));
            document.head.appendChild(script);
          });
        }

        if (!mapContainerRef.current) return;

        const center = latitude && longitude
          ? { lat: latitude, lng: longitude }
          : { lat: 9.06, lng: 7.49 };

        const map = new google.maps.Map(mapContainerRef.current, {
          center,
          zoom: latitude ? 12 : 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          ],
        });
        mapInstanceRef.current = map;

        // Init Places services
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        placesServiceRef.current = new google.maps.places.PlacesService(map);

        // Draw coverage polygons
        const bounds = new google.maps.LatLngBounds();
        let hasPolygons = false;

        coverageAreas.forEach((area) => {
          const coords = area.polygon as Array<{ lat: number; lng: number }>;
          if (!coords || !Array.isArray(coords) || coords.length < 3) return;

          const polygon = new google.maps.Polygon({
            paths: coords,
            strokeColor: area.color || '#22c55e',
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: area.color || '#22c55e',
            fillOpacity: 0.15,
            clickable: true,
          });
          polygon.setMap(map);
          hasPolygons = true;

          const infoWindow = new google.maps.InfoWindow();
          polygon.addListener('click', (e: google.maps.MapMouseEvent) => {
            infoWindow.setContent(`
              <div style="padding:4px 8px;font-family:system-ui,sans-serif;">
                <strong style="font-size:14px;">${area.name}</strong>
                <p style="font-size:12px;color:#666;margin:4px 0 0;">Active delivery zone</p>
              </div>
            `);
            infoWindow.setPosition(e.latLng);
            infoWindow.open(map);
          });

          coords.forEach(c => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));
        });

        if (latitude && longitude) {
          new google.maps.Marker({
            position: { lat: latitude, lng: longitude },
            map,
            title: 'Your Location',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#3b82f6',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          });
        }

        if (hasPolygons && !latitude) {
          map.fitBounds(bounds, 40);
        }

        setMapLoading(false);
      } catch (err) {
        console.error('Map init error:', err);
        setError('Failed to load map');
        setMapLoading(false);
      }
    };
    initMap();
  }, [loading, latitude, longitude, coverageAreas]);

  // Search handler with debounce
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!value.trim() || !autocompleteServiceRef.current) {
      setSearchSuggestions([]);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      autocompleteServiceRef.current!.getPlacePredictions(
        {
          input: value,
          componentRestrictions: { country: 'ng' },
          types: ['(regions)'],
        },
        (predictions, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSearchSuggestions(
              predictions.map(p => ({ place_id: p.place_id, description: p.description }))
            );
          } else {
            setSearchSuggestions([]);
          }
        }
      );
    }, 300);
  }, []);

  const handleSelectSuggestion = useCallback((suggestion: SearchSuggestion) => {
    if (!placesServiceRef.current || !mapInstanceRef.current) return;

    placesServiceRef.current.getDetails(
      { placeId: suggestion.place_id, fields: ['geometry'] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          mapInstanceRef.current!.setCenter(place.geometry.location);
          if (place.geometry.viewport) {
            mapInstanceRef.current!.fitBounds(place.geometry.viewport);
          } else {
            mapInstanceRef.current!.setZoom(13);
          }
        }
      }
    );

    setSearchQuery(suggestion.description);
    setSearchSuggestions([]);
    setSearchOpen(false);
  }, []);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={() => navigate('/')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground">Delivery Coverage</h1>
          </div>
          {/* Coverage Areas Dropdown */}
          {coverageAreas.length > 0 && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setLegendOpen(!legendOpen)}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Areas</span>
                <span className="inline sm:hidden">{coverageAreas.length}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${legendOpen ? 'rotate-180' : ''}`} />
              </Button>

              {legendOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setLegendOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg p-2 min-w-[200px] max-h-[250px] overflow-y-auto">
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Coverage Zones</p>
                    {coverageAreas.map((area) => (
                      <button
                        key={area.id}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary text-left text-sm"
                        onClick={() => {
                          // Pan to area center
                          const coords = area.polygon as Array<{ lat: number; lng: number }>;
                          if (coords?.length && mapInstanceRef.current) {
                            const bounds = new google.maps.LatLngBounds();
                            coords.forEach(c => bounds.extend(new google.maps.LatLng(c.lat, c.lng)));
                            mapInstanceRef.current.fitBounds(bounds, 40);
                          }
                          setLegendOpen(false);
                        }}
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: area.color }} />
                        <span className="truncate">{area.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Search Bar */}
      <div className="relative z-30 px-3 py-2 bg-background border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search city, town, state..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2"
              onClick={() => { setSearchQuery(''); setSearchSuggestions([]); }}
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Search Suggestions */}
        {searchOpen && searchSuggestions.length > 0 && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => { setSearchOpen(false); setSearchSuggestions([]); }} />
            <div className="absolute left-3 right-3 top-full mt-1 z-30 bg-background border border-border rounded-lg shadow-lg max-h-[200px] overflow-y-auto">
              {searchSuggestions.map((s) => (
                <button
                  key={s.place_id}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary text-left text-sm border-b border-border last:border-0"
                  onClick={() => handleSelectSuggestion(s)}
                >
                  <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{s.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        {(loading || mapLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading map...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <p className="text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </div>
        )}

        {!error && coverageAreas.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <MapPin className="w-10 h-10 text-muted-foreground" />
              <p className="font-medium text-foreground">No coverage areas defined yet</p>
              <p className="text-sm text-muted-foreground">We're working on expanding our delivery zones. Check back soon!</p>
            </div>
          </div>
        )}

        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      <BottomNav activeTab="coverage" />
    </div>
  );
}
