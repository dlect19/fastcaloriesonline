import { useState, useEffect } from 'react';
import { MapPin, Search, Loader2, Navigation, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';

interface LocationSearchProps {
  onLocationSelect: (lat: number, lon: number, label: string) => void;
  currentLocation: { lat: number | null; lon: number | null; label: string } | null;
  onClearLocation: () => void;
}

export function LocationSearch({ onLocationSelect, currentLocation, onClearLocation }: LocationSearchProps) {
  const { toast } = useToast();
  const { latitude, longitude, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [waitingForGps, setWaitingForGps] = useState(false);
  const [formData, setFormData] = useState({
    address: '',
    city: '',
    state: 'Lagos',
  });

  // Watch for GPS coordinates when waiting
  useEffect(() => {
    if (waitingForGps && latitude && longitude) {
      onLocationSelect(latitude, longitude, 'My Location');
      setIsOpen(false);
      setWaitingForGps(false);
      toast({
        title: 'Location Set',
        description: 'Showing vendors near your current location.',
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

  const handleSearchAddress = async () => {
    if (!formData.address.trim() || !formData.city.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please enter at least an address and city.',
        variant: 'destructive',
      });
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('geocode-address', {
        body: {
          address: formData.address,
          city: formData.city,
          state: formData.state || 'Lagos',
          country: 'Nigeria',
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || 'Geocoding failed');
      }

      onLocationSelect(data.latitude, data.longitude, `${formData.address}, ${formData.city}`);
      setIsOpen(false);
      toast({
        title: 'Location Set',
        description: `Showing vendors near ${formData.address}, ${formData.city}`,
      });
    } catch (error) {
      toast({
        title: 'Address Not Found',
        description: 'Could not find that address. Try a more specific location.',
        variant: 'destructive',
      });
    } finally {
      setSearching(false);
    }
  };

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
                formData={formData}
                setFormData={setFormData}
                searching={searching}
                geoLoading={geoLoading || waitingForGps}
                onUseMyLocation={handleUseMyLocation}
                onSearchAddress={handleSearchAddress}
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
              formData={formData}
              setFormData={setFormData}
              searching={searching}
              geoLoading={geoLoading || waitingForGps}
              onUseMyLocation={handleUseMyLocation}
              onSearchAddress={handleSearchAddress}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface LocationFormProps {
  formData: { address: string; city: string; state: string };
  setFormData: (data: { address: string; city: string; state: string }) => void;
  searching: boolean;
  geoLoading: boolean;
  onUseMyLocation: () => void;
  onSearchAddress: () => void;
}

function LocationForm({
  formData,
  setFormData,
  searching,
  geoLoading,
  onUseMyLocation,
  onSearchAddress,
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
        Use My Current Location
      </Button>

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <span className="relative bg-background px-2 text-xs text-muted-foreground">or enter address</span>
      </div>

      {/* Manual Address Entry */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="address">Street Address</Label>
          <Input
            id="address"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            placeholder="e.g., 123 Main Street, Lekki"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="e.g., Lagos"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              placeholder="e.g., Lagos"
            />
          </div>
        </div>
      </div>

      <Button className="w-full gap-2" onClick={onSearchAddress} disabled={searching}>
        {searching ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Search className="w-4 h-4" />
        )}
        Find Vendors Near This Address
      </Button>
    </div>
  );
}
