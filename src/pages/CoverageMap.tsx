import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export default function CoverageMap() {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          : { lat: 9.06, lng: 7.49 }; // Default: Nigeria center

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

          // Info window on click
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

        // Customer marker
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

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Delivery Coverage</h1>
            <p className="text-xs text-muted-foreground">Areas where we deliver</p>
          </div>
        </div>
      </header>

      {/* Legend */}
      {coverageAreas.length > 0 && (
        <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-border bg-secondary/30">
          {coverageAreas.map((area) => (
            <span
              key={area.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-background border border-border"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: area.color }} />
              {area.name}
            </span>
          ))}
        </div>
      )}

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
