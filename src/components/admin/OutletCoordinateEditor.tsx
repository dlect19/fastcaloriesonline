import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { MapPin, Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MapLocationPicker } from '@/components/shared/MapLocationPicker';

interface OutletCoordinateEditorProps {
  outlet: {
    id: string;
    outlet_name: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  onUpdate: () => void;
}

export function OutletCoordinateEditor({ outlet, onUpdate }: OutletCoordinateEditorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [latitude, setLatitude] = useState(outlet.latitude?.toString() || '');
  const [longitude, setLongitude] = useState(outlet.longitude?.toString() || '');
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const sessionTokenRef = useRef(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const searchAddress = async (input: string) => {
    setAddressQuery(input);
    if (input.length < 3) { setSuggestions([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data } = await supabase.functions.invoke('google-places-autocomplete', {
          body: { input, sessionToken: sessionTokenRef.current },
        });
        setSuggestions(data?.predictions || []);
      } catch { setSuggestions([]); }
      setSearchLoading(false);
    }, 300);
  };

  const selectPlace = async (placeId: string) => {
    setSuggestions([]);
    setSearchLoading(true);
    try {
      const { data } = await supabase.functions.invoke('google-place-details', {
        body: { place_id: placeId, sessionToken: sessionTokenRef.current },
      });
      if (data?.latitude && data?.longitude) {
        setLatitude(data.latitude.toString());
        setLongitude(data.longitude.toString());
        setAddressQuery(data.formatted_address || '');
        toast({ title: 'Coordinates found', description: `${data.latitude}, ${data.longitude}` });
      } else {
        toast({ title: 'Could not resolve coordinates', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Lookup failed', variant: 'destructive' });
    }
    setSearchLoading(false);
    sessionTokenRef.current = crypto.randomUUID();
  };

  const handleSave = async () => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      toast({ title: 'Invalid coordinates', description: 'Please enter valid numbers', variant: 'destructive' });
      return;
    }
    if (lat < -90 || lat > 90) {
      toast({ title: 'Invalid latitude', description: 'Must be between -90 and 90', variant: 'destructive' });
      return;
    }
    if (lon < -180 || lon > 180) {
      toast({ title: 'Invalid longitude', description: 'Must be between -180 and 180', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('vendor_outlets')
        .update({ latitude: lat, longitude: lon })
        .eq('id', outlet.id);

      if (error) throw error;

      toast({ title: 'Coordinates updated', description: `${outlet.outlet_name} location has been updated` });
      setOpen(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating outlet coordinates:', error);
      toast({ title: 'Failed to update coordinates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setLatitude(outlet.latitude?.toString() || '');
      setLongitude(outlet.longitude?.toString() || '');
      setAddressQuery('');
      setSuggestions([]);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1">
        <MapPin className="w-3 h-3" />
        Set Location
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Location: {outlet.outlet_name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Search Address</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Type an address to lookup coordinates…"
                  value={addressQuery}
                  onChange={(e) => searchAddress(e.target.value)}
                  className="pl-9"
                />
                {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
              </div>
              {suggestions.length > 0 && (
                <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                  {suggestions.map((s: any) => (
                    <button
                      key={s.place_id}
                      onClick={() => selectPlace(s.place_id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      {s.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Pick on Map</Label>
              <MapLocationPicker
                latitude={latitude ? parseFloat(latitude) : undefined}
                longitude={longitude ? parseFloat(longitude) : undefined}
                onLocationSelect={(lat, lng) => {
                  setLatitude(lat.toFixed(6));
                  setLongitude(lng.toFixed(6));
                }}
                height="250px"
              />
              <p className="text-xs text-muted-foreground">Click on the map or drag the marker to set location</p>
            </div>

            <div className="relative flex items-center gap-2 py-1">
              <div className="flex-1 border-t" />
              <span className="text-xs text-muted-foreground">or enter manually</span>
              <div className="flex-1 border-t" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="outlet-lat">Latitude</Label>
              <Input id="outlet-lat" type="number" step="any" placeholder="e.g. 6.5244" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              <p className="text-xs text-muted-foreground">Range: -90 to 90</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outlet-lng">Longitude</Label>
              <Input id="outlet-lng" type="number" step="any" placeholder="e.g. 3.3792" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              <p className="text-xs text-muted-foreground">Range: -180 to 180</p>
            </div>

            {outlet.latitude && outlet.longitude && (
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">Current coordinates:</p>
                <p className="text-muted-foreground">{outlet.latitude}, {outlet.longitude}</p>
              </div>
            )}

            {(!outlet.latitude || !outlet.longitude) && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                <p className="text-destructive">⚠️ This outlet has no coordinates set. It won't appear in nearby searches.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Coordinates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
