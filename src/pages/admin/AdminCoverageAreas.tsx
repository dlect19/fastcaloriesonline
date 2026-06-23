import { useState, useEffect, useRef, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pencil, MapPin, Loader2, Save, X, Eye, EyeOff, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface LatLng {
  lat: number;
  lng: number;
}

interface CoverageArea {
  id: string;
  name: string;
  polygon: LatLng[];
  color: string;
  is_active: boolean;
  is_coming_soon: boolean;
  created_at: string;
}

let googleMapsPromise: Promise<void> | null = null;
let googleMapsLoaded = false;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) { googleMapsLoaded = true; resolve(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=drawing,places`;
    script.async = true;
    script.onload = () => { googleMapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

const PRESET_COLORS = ['#FF8C00', '#4CAF50', '#2196F3', '#9C27B0', '#F44336', '#00BCD4', '#FF9800', '#795548'];

export default function AdminCoverageAreas() {
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const drawingPointsRef = useRef<LatLng[]>([]);
  const previewPolygonRef = useRef<google.maps.Polygon | null>(null);
  const previewMarkersRef = useRef<google.maps.Marker[]>([]);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [areas, setAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<LatLng[]>([]);
  const [editDialog, setEditDialog] = useState<{ open: boolean; area: CoverageArea | null; isNew: boolean }>({ open: false, area: null, isNew: false });
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#FF8C00');
  const [editComingSoon, setEditComingSoon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<{ place_id: string; description: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchAreas = useCallback(async () => {
    const { data, error } = await supabase.from('coverage_areas').select('*').order('created_at', { ascending: true });
    if (error) { console.error(error); return; }
    setAreas((data || []).map((a: any) => ({ ...a, polygon: Array.isArray(a.polygon) ? a.polygon : [] })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAreas(); }, [fetchAreas]);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const response = await fetch(`${supabaseUrl}/functions/v1/get-google-maps-key`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseAnonKey}`, 'apikey': supabaseAnonKey, 'Content-Type': 'application/json' },
        });
        const data = await response.json();
        if (!data?.key || cancelled) return;
        await loadGoogleMaps(data.key);
        if (cancelled || !mapRef.current) return;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 6.5244, lng: 3.3792 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapInstanceRef.current = map;
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        placesServiceRef.current = new google.maps.places.PlacesService(map);
        setMapLoading(false);
      } catch (err) {
        console.error('Map init error:', err);
        setMapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Render all saved polygons on map
  const renderPolygons = useCallback(() => {
    // Clear existing
    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polygonsRef.current = [];
    markersRef.current = [];

    if (!mapInstanceRef.current) return;

    areas.forEach(area => {
      if (!area.polygon || area.polygon.length < 3) return;
      const polygon = new google.maps.Polygon({
        paths: area.polygon,
        strokeColor: area.color,
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: area.color,
        fillOpacity: 0.25,
        map: mapInstanceRef.current!,
        clickable: false,
      });
      polygonsRef.current.push(polygon);

      // Label marker at centroid
      const centroid = getCentroid(area.polygon);
      const marker = new google.maps.Marker({
        position: centroid,
        map: mapInstanceRef.current!,
        label: { text: area.name, color: '#fff', fontWeight: 'bold', fontSize: '12px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        },
      });
      markersRef.current.push(marker);
    });
  }, [areas]);

  useEffect(() => {
    if (!mapLoading) renderPolygons();
  }, [renderPolygons, mapLoading]);

  // Drawing mode click handler
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    let listener: google.maps.MapsEventListener | null = null;

    if (isDrawing) {
      listener = mapInstanceRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        drawingPointsRef.current = [...drawingPointsRef.current, point];
        setDrawingPoints([...drawingPointsRef.current]);
        updatePreviewPolygon(drawingPointsRef.current);
      });
    }

    return () => { if (listener) google.maps.event.removeListener(listener); };
  }, [isDrawing]);

  const updatePreviewPolygon = (points: LatLng[]) => {
    // Clear previous preview markers
    previewMarkersRef.current.forEach(m => m.setMap(null));
    previewMarkersRef.current = [];

    if (previewPolygonRef.current) {
      previewPolygonRef.current.setPath(points);
    } else if (mapInstanceRef.current && points.length >= 2) {
      previewPolygonRef.current = new google.maps.Polygon({
        paths: points,
        strokeColor: editColor,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: editColor,
        fillOpacity: 0.2,
        map: mapInstanceRef.current,
      });
    }

    // Add point markers
    points.forEach((p, i) => {
      const marker = new google.maps.Marker({
        position: p,
        map: mapInstanceRef.current!,
        label: { text: `${i + 1}`, color: '#fff', fontSize: '10px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: editColor,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });
      previewMarkersRef.current.push(marker);
    });
  };

  const clearPreview = () => {
    previewPolygonRef.current?.setMap(null);
    previewPolygonRef.current = null;
    previewMarkersRef.current.forEach(m => m.setMap(null));
    previewMarkersRef.current = [];
  };

  const startDrawing = () => {
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    clearPreview();
    setIsDrawing(true);
    setEditName(`Coverage Area ${areas.length + 1}`);
    setEditColor(PRESET_COLORS[areas.length % PRESET_COLORS.length]);
    setEditComingSoon(false);
    toast({ title: 'Drawing mode', description: 'Click on the map to place polygon points. Click "Finish" when done.' });
  };

  const finishDrawing = () => {
    const points = drawingPointsRef.current;
    if (points.length < 3) {
      toast({ title: 'Need at least 3 points', variant: 'destructive' });
      return;
    }
    setIsDrawing(false);
    setEditDialog({ open: true, area: null, isNew: true });
  };

  const cancelDrawing = () => {
    setIsDrawing(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    clearPreview();
  };

  const undoLastPoint = () => {
    if (drawingPointsRef.current.length === 0) return;
    drawingPointsRef.current = drawingPointsRef.current.slice(0, -1);
    setDrawingPoints([...drawingPointsRef.current]);
    updatePreviewPolygon(drawingPointsRef.current);
  };

  const saveArea = async () => {
    setSaving(true);
    try {
      if (editDialog.isNew) {
        const { error } = await supabase.from('coverage_areas').insert({
          name: editName,
          polygon: drawingPointsRef.current as any,
          color: editColor,
          is_active: !editComingSoon,
          is_coming_soon: editComingSoon,
        } as any);
        if (error) throw error;
        toast({ title: editComingSoon ? 'Coming-soon zone created!' : 'Coverage area created!' });
      } else if (editDialog.area) {
        const { error } = await supabase.from('coverage_areas')
          .update({ name: editName, color: editColor, is_coming_soon: editComingSoon, updated_at: new Date().toISOString() } as any)
          .eq('id', editDialog.area.id);
        if (error) throw error;
        toast({ title: 'Coverage area updated!' });
      }
      clearPreview();
      drawingPointsRef.current = [];
      setDrawingPoints([]);
      setEditDialog({ open: false, area: null, isNew: false });
      fetchAreas();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (area: CoverageArea) => {
    const { error } = await supabase.from('coverage_areas')
      .update({ is_active: !area.is_active, updated_at: new Date().toISOString() })
      .eq('id', area.id);
    if (error) { toast({ title: 'Error', variant: 'destructive' }); return; }
    fetchAreas();
  };

  const deleteArea = async (id: string) => {
    if (!confirm('Delete this coverage area?')) return;
    const { error } = await supabase.from('coverage_areas').delete().eq('id', id);
    if (error) { toast({ title: 'Error', variant: 'destructive' }); return; }
    toast({ title: 'Deleted' });
    fetchAreas();
  };

  const editExisting = (area: CoverageArea) => {
    setEditName(area.name);
    setEditColor(area.color);
    setEditComingSoon(!!area.is_coming_soon);
    setEditDialog({ open: true, area, isNew: false });
  };

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.length < 3) { setSearchSuggestions([]); setShowSuggestions(false); return; }
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (!autocompleteServiceRef.current) return;
      setSearchLoading(true);
      autocompleteServiceRef.current.getPlacePredictions(
        { input: value, componentRestrictions: { country: 'ng' }, types: ['(regions)'] },
        (predictions, status) => {
          setSearchLoading(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSearchSuggestions(predictions.map(p => ({ place_id: p.place_id, description: p.description })));
            setShowSuggestions(true);
          } else { setSearchSuggestions([]); setShowSuggestions(false); }
        }
      );
    }, 300);
  }, []);

  const handleSelectSearchSuggestion = useCallback((suggestion: { place_id: string; description: string }) => {
    if (!placesServiceRef.current) return;
    setSearchSuggestions([]); setShowSuggestions(false); setSearchQuery(suggestion.description);
    placesServiceRef.current.getDetails(
      { placeId: suggestion.place_id, fields: ['geometry'] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          mapInstanceRef.current?.setCenter(place.geometry.location);
          if (place.geometry.viewport) {
            mapInstanceRef.current?.fitBounds(place.geometry.viewport);
          } else {
            mapInstanceRef.current?.setZoom(13);
          }
        }
      }
    );
  }, []);

  const focusArea = (area: CoverageArea) => {
    if (!mapInstanceRef.current || !area.polygon?.length) return;
    const bounds = new google.maps.LatLngBounds();
    area.polygon.forEach(p => bounds.extend(p));
    mapInstanceRef.current.fitBounds(bounds, 50);
  };

  return (
    <AdminLayout>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coverage Areas</h1>
            <p className="text-sm text-muted-foreground">Draw polygons on the map to define delivery coverage zones</p>
          </div>
          {!isDrawing ? (
            <Button onClick={startDrawing} className="gap-2">
              <Plus className="w-4 h-4" /> Draw New Zone
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={undoLastPoint} disabled={drawingPoints.length === 0}>Undo Point</Button>
              <Button variant="destructive" size="sm" onClick={cancelDrawing}><X className="w-4 h-4 mr-1" /> Cancel</Button>
              <Button size="sm" onClick={finishDrawing} disabled={drawingPoints.length < 3}>
                <Save className="w-4 h-4 mr-1" /> Finish ({drawingPoints.length} pts)
              </Button>
            </div>
          )}
        </div>

        {isDrawing && (
          <div className="mb-3 p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm text-primary">
            <MapPin className="w-4 h-4 inline mr-1" />
            Click on the map to place points. Connect at least 3 points to form a coverage polygon. Click "Finish" when done.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Map */}
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="p-0 relative">
                {mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10 rounded-lg">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {/* Search bar */}
                <div className="absolute top-3 left-3 right-3 z-20" style={{ maxWidth: '400px' }}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      onFocus={() => { if (searchSuggestions.length > 0) setShowSuggestions(true); }}
                      onBlur={() => { setTimeout(() => setShowSuggestions(false), 200); }}
                      placeholder="Search city, town, state, LGA..."
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
                  </div>
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <div className="mt-1 bg-background border border-input rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchSuggestions.map((s) => (
                        <button
                          key={s.place_id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); handleSelectSearchSuggestion(s); }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-start gap-2 border-b border-border last:border-b-0"
                        >
                          <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span className="text-foreground">{s.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div ref={mapRef} className="w-full rounded-lg" style={{ height: '500px' }} />
              </CardContent>
            </Card>
          </div>

          {/* Area list */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground">Zones ({areas.length})</h3>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : areas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No coverage areas defined yet. Click "Draw New Zone" to create one.</p>
            ) : (
              areas.map(area => (
                <Card key={area.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => focusArea(area)}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: area.color }} />
                      <span className="font-medium text-sm text-foreground flex-1">{area.name}</span>
                      <Badge
                        variant={area.is_coming_soon ? 'outline' : area.is_active ? 'default' : 'secondary'}
                        className={`text-xs ${area.is_coming_soon ? 'border-amber-500 text-amber-600' : ''}`}
                      >
                        {area.is_coming_soon ? 'Coming Soon' : area.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{area.polygon?.length || 0} points</p>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); toggleActive(area); }}>
                        {area.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); editExisting(area); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={(e) => { e.stopPropagation(); deleteArea(area.id); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* Edit/Create Dialog */}
        <Dialog open={editDialog.open} onOpenChange={(open) => { if (!open) { setEditDialog({ open: false, area: null, isNew: false }); clearPreview(); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editDialog.isNew ? 'Create Coverage Area' : 'Edit Coverage Area'}</DialogTitle>
              <DialogDescription>
                {editDialog.isNew ? `${drawingPointsRef.current.length} points selected` : 'Update the zone details'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Zone Name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="e.g. Lagos Mainland" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 transition-all ${editColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setEditColor(c)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3 bg-amber-50 dark:bg-amber-950/20">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Coming Soon</Label>
                  <p className="text-xs text-muted-foreground">Show this zone on the public map as a "Coming Soon" area (not yet serviced).</p>
                </div>
                <Switch checked={editComingSoon} onCheckedChange={setEditComingSoon} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditDialog({ open: false, area: null, isNew: false }); clearPreview(); }}>Cancel</Button>
              <Button onClick={saveArea} disabled={saving || !editName.trim()}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editDialog.isNew ? 'Create Zone' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </AdminLayout>
  );
}

function getCentroid(points: LatLng[]): LatLng {
  const n = points.length;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / n, lng: sum.lng / n };
}
