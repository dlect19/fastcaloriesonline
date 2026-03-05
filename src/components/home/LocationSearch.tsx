import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Search, Loader2, Navigation, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useAuth } from '@/hooks/useAuth';

interface PlacePrediction {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
}

interface LocationSearchProps {
  onLocationSelect: (lat: number, lon: number, label: string, state?: string | null) => void;
  currentLocation: { lat: number | null; lon: number | null; label: string; state?: string | null } | null;
  onClearLocation: () => void;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

interface SavedAddress {
  id: string;
  label: string;
  address_line: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean | null;
}

export function LocationSearch({ onLocationSelect, currentLocation, onClearLocation, externalOpen, onExternalOpenChange }: LocationSearchProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { latitude, longitude, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();
  const [internalOpen, setInternalOpen] = useState(false);
  
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = (open: boolean) => {
    if (onExternalOpenChange) onExternalOpenChange(open);
    setInternalOpen(open);
  };

  const [waitingForGps, setWaitingForGps] = useState(false);
  const [reversingGps, setReversingGps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const sessionTokenRef = useRef(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch saved addresses
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .then(({ data }) => {
        if (data) setSavedAddresses(data as SavedAddress[]);
      });
  }, [user?.id]);

  // Watch for GPS coordinates when waiting
  useEffect(() => {
    if (waitingForGps && latitude && longitude) {
      setWaitingForGps(false);
      setReversingGps(true);
      
      // Reverse geocode to get actual address
      supabase.functions.invoke('google-reverse-geocode', {
        body: { latitude, longitude },
      }).then(({ data, error }) => {
        setReversingGps(false);
        
        if (error || !data) {
          // GPS fallback — no state available, edge function will reverse-geocode
          onLocationSelect(latitude, longitude, 'My Location', null);
        } else {
          const label = data.address_label 
            ? `${data.address_label}${data.neighborhood ? ', ' + data.neighborhood : ''}`
            : data.formatted_address?.split(',').slice(0, 2).join(',') || 'My Location';
          // Pass state from reverse geocode result if available
          const state = data.state || null;
          onLocationSelect(latitude, longitude, label, state);
        }
        
        setIsOpen(false);
        toast({
          title: 'Location Set',
          description: 'Showing vendors near your current location.',
        });
      });
    } else if (waitingForGps && geoError) {
      setWaitingForGps(false);
      toast({
        title: 'Location Error',
        description: geoError,
        variant: 'destructive',
      });
    }
  }, [latitude, longitude, geoError, waitingForGps, onLocationSelect, toast]);

  const handleUseMyLocation = () => {
    setWaitingForGps(true);
    getCurrentPosition();
  };

  // Debounced autocomplete search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    if (value.trim().length < 3) {
      setPredictions([]);
      return;
    }
    
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('google-places-autocomplete', {
          body: { input: value, sessionToken: sessionTokenRef.current },
        });

        if (!error && data?.predictions) {
          setPredictions(data.predictions);
        }
      } catch (err) {
        console.error('Autocomplete error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  // Handle selecting a place prediction
  const handleSelectPlace = async (prediction: PlacePrediction) => {
    setSelectingPlace(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-place-details', {
        body: { place_id: prediction.place_id, sessionToken: sessionTokenRef.current },
      });

      if (error || !data?.latitude || !data?.longitude) {
        throw new Error('Failed to get place details');
      }

      // Generate a new session token for next autocomplete session
      sessionTokenRef.current = crypto.randomUUID();

      const label = prediction.main_text || prediction.description.split(',')[0];
      // Extract state from place details if available
      const placeState = data.state || null;
      onLocationSelect(data.latitude, data.longitude, label, placeState);
      setIsOpen(false);
      setPredictions([]);
      setSearchQuery('');
      
      toast({
        title: 'Location Set',
        description: `Showing vendors near ${label}`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Could not get location details. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSelectingPlace(false);
    }
  };

  const handleSelectSavedAddress = (addr: SavedAddress) => {
    if (addr.latitude && addr.longitude) {
      onLocationSelect(addr.latitude, addr.longitude, `${addr.label}: ${addr.address_line}`, addr.state);
      setIsOpen(false);
      toast({ title: 'Location Set', description: `Showing vendors near ${addr.address_line}` });
    }
  };

  const isLoadingGps = geoLoading || waitingForGps || reversingGps;

  return (
    <div className="w-full">
      {currentLocation && currentLocation.lat && currentLocation.lon ? (
        <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-xl border border-primary/20">
          <MapPin className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm text-foreground flex-1 truncate">{currentLocation.label}</span>
          <Button variant="ghost" size="sm" onClick={onClearLocation} className="h-8 w-8 p-0">
            <X className="w-4 h-4" />
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                Change
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set Delivery Location</DialogTitle>
              </DialogHeader>
              <LocationForm
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                predictions={predictions}
                searching={searching}
                selectingPlace={selectingPlace}
                geoLoading={isLoadingGps}
                onUseMyLocation={handleUseMyLocation}
                onSelectPlace={handleSelectPlace}
                savedAddresses={savedAddresses}
                onSelectSavedAddress={handleSelectSavedAddress}
              />
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full justify-start gap-2 h-12 border-dashed">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Enter delivery address to see nearby vendors</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Delivery Location</DialogTitle>
            </DialogHeader>
            <LocationForm
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              predictions={predictions}
              searching={searching}
              selectingPlace={selectingPlace}
              geoLoading={isLoadingGps}
              onUseMyLocation={handleUseMyLocation}
              onSelectPlace={handleSelectPlace}
              savedAddresses={savedAddresses}
              onSelectSavedAddress={handleSelectSavedAddress}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface LocationFormProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  predictions: PlacePrediction[];
  searching: boolean;
  selectingPlace: boolean;
  geoLoading: boolean;
  onUseMyLocation: () => void;
  onSelectPlace: (prediction: PlacePrediction) => void;
  savedAddresses: SavedAddress[];
  onSelectSavedAddress: (addr: SavedAddress) => void;
}

function LocationForm({
  searchQuery,
  onSearchChange,
  predictions,
  searching,
  selectingPlace,
  geoLoading,
  onUseMyLocation,
  onSelectPlace,
  savedAddresses,
  onSelectSavedAddress,
}: LocationFormProps) {
  return (
    <div className="space-y-4 pt-4">
      {/* Use GPS */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={onUseMyLocation}
        disabled={geoLoading}
      >
        {geoLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Navigation className="w-4 h-4" />
        )}
        {geoLoading ? 'Getting your location...' : 'Use My Current Location'}
      </Button>

      {/* Saved Addresses */}
      {savedAddresses.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Saved Addresses</p>
          <div className="space-y-1">
            {savedAddresses.map((addr) => (
              <button
                key={addr.id}
                onClick={() => onSelectSavedAddress(addr)}
                disabled={!addr.latitude || !addr.longitude}
                className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 transition-colors text-left disabled:opacity-50"
              >
                <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{addr.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{addr.address_line}, {addr.city}, {addr.state}</p>
                </div>
                {addr.is_default && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">Default</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <span className="relative bg-background px-2 text-xs text-muted-foreground">or search address</span>
      </div>

      {/* Google Places Autocomplete Search */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search for an address or landmark..."
            className="pl-9 pr-9"
            autoFocus
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Predictions dropdown */}
        {predictions.length > 0 && (
          <div className="mt-2 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
            {predictions.map((prediction) => (
              <button
                key={prediction.place_id}
                onClick={() => onSelectPlace(prediction)}
                disabled={selectingPlace}
                className="w-full flex items-start gap-3 px-3 py-3 hover:bg-secondary/50 transition-colors text-left border-b border-border last:border-b-0 disabled:opacity-50"
              >
                <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{prediction.main_text}</p>
                  <p className="text-xs text-muted-foreground truncate">{prediction.secondary_text}</p>
                </div>
                {selectingPlace && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {/* No results message */}
        {searchQuery.length >= 3 && !searching && predictions.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground text-center py-3">
            No addresses found. Try a different search term.
          </p>
        )}
      </div>
    </div>
  );
}
