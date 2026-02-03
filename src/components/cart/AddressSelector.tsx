import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAndUpdateAddress } from '@/lib/geocoding';
import { useGeolocation } from '@/hooks/useGeolocation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Plus, Home, Briefcase, ChevronRight, Loader2, Navigation, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Address = Tables<'addresses'>;

interface AddressSelectorProps {
  addresses: Address[];
  selectedAddress: Address | null;
  onSelect: (address: Address) => void;
  loading: boolean;
  userId: string;
  onAddressAdded: () => void;
}

const labelIcons: Record<string, React.ReactNode> = {
  Home: <Home className="w-4 h-4" />,
  Work: <Briefcase className="w-4 h-4" />,
  Other: <MapPin className="w-4 h-4" />,
};

export function AddressSelector({
  addresses,
  selectedAddress,
  onSelect,
  loading,
  userId,
  onAddressAdded,
}: AddressSelectorProps) {
  const { toast } = useToast();
  const { latitude: geoLat, longitude: geoLon, getCurrentPosition, loading: geoLoading, error: geoError } = useGeolocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [updatingGps, setUpdatingGps] = useState<string | null>(null);
  const [pendingGpsUpdate, setPendingGpsUpdate] = useState<string | null>(null);
  const [waitingForGps, setWaitingForGps] = useState<'new' | null>(null);
  const [formData, setFormData] = useState({
    label: 'Home',
    address_line: '',
    city: '',
    state: '',
  });

  // Handle GPS location updates for new address
  useEffect(() => {
    if (waitingForGps === 'new' && geoLat && geoLon && !geoLoading) {
      setGpsLocation({ lat: geoLat, lon: geoLon });
      setWaitingForGps(null);
      toast({
        title: 'Location Captured',
        description: 'GPS coordinates saved. Now fill in the address details.',
      });
    }
    if (waitingForGps === 'new' && geoError && !geoLoading) {
      setWaitingForGps(null);
      toast({
        title: 'Location Error',
        description: geoError,
        variant: 'destructive',
      });
    }
  }, [geoLat, geoLon, geoLoading, geoError, waitingForGps, toast]);

  // Handle GPS location updates for existing address
  useEffect(() => {
    const updateAddress = async () => {
      if (pendingGpsUpdate && geoLat && geoLon && !geoLoading) {
        const addressId = pendingGpsUpdate;
        setPendingGpsUpdate(null);

        try {
          const { error } = await supabase
            .from('addresses')
            .update({
              latitude: geoLat,
              longitude: geoLon,
            })
            .eq('id', addressId);

          if (error) throw error;

          // Update local state
          const updatedAddress = addresses.find(a => a.id === addressId);
          if (updatedAddress && selectedAddress?.id === addressId) {
            onSelect({
              ...updatedAddress,
              latitude: geoLat,
              longitude: geoLon,
            });
          }
          
          onAddressAdded(); // Refresh addresses list
          
          toast({
            title: 'Location Updated',
            description: 'GPS coordinates saved for accurate delivery fee.',
          });
        } catch (error) {
          toast({
            title: 'Error',
            description: 'Failed to update location',
            variant: 'destructive',
          });
        } finally {
          setUpdatingGps(null);
        }
      }
      if (pendingGpsUpdate && geoError && !geoLoading) {
        setPendingGpsUpdate(null);
        setUpdatingGps(null);
        toast({
          title: 'Location Error',
          description: geoError,
          variant: 'destructive',
        });
      }
    };
    updateAddress();
  }, [geoLat, geoLon, geoLoading, geoError, pendingGpsUpdate, addresses, selectedAddress, onSelect, onAddressAdded, toast]);

  // Get GPS location for new address
  const handleGetGpsLocation = () => {
    setWaitingForGps('new');
    getCurrentPosition();
  };

  // Update existing address with GPS coordinates
  const handleUpdateAddressGps = (addressId: string) => {
    setUpdatingGps(addressId);
    setPendingGpsUpdate(addressId);
    getCurrentPosition();
  };

  const handleAddAddress = async () => {
    if (!formData.address_line.trim() || !formData.city.trim() || !formData.state.trim()) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const insertData: any = {
        user_id: userId,
        label: formData.label,
        address_line: formData.address_line.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        is_default: addresses.length === 0,
      };

      // Include GPS coordinates if captured
      if (gpsLocation) {
        insertData.latitude = gpsLocation.lat;
        insertData.longitude = gpsLocation.lon;
      }

      const { data, error } = await supabase
        .from('addresses')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: gpsLocation 
          ? 'Address added with precise location!' 
          : 'Address added. Calculating location...',
      });
      setIsAddOpen(false);
      setFormData({ label: 'Home', address_line: '', city: '', state: '' });
      setGpsLocation(null);
      onAddressAdded();
      
      // Auto-select the new address
      if (data) {
        onSelect(data);
        
        // Only geocode if GPS wasn't provided
        if (!gpsLocation) {
          geocodeAndUpdateAddress(data.id, data.address_line, data.city, data.state)
            .then((result) => {
              if (result) {
                onSelect({ ...data, latitude: result.latitude, longitude: result.longitude });
                toast({
                  title: 'Location Found',
                  description: 'Delivery fee calculated based on distance.',
                });
              }
            })
            .catch((err) => {
              console.error('Geocoding failed:', err);
            });
        }
      }
    } catch (error) {
      console.error('Error adding address:', error);
      toast({
        title: 'Error',
        description: 'Failed to add address',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-border shadow-soft">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          Delivery Address
        </CardTitle>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <button className="w-full p-4 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-center">
                <div className="flex flex-col items-center gap-2">
                  <Plus className="w-6 h-6 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Add delivery address</p>
                </div>
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Address</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                {/* GPS Location Button */}
                <div className="p-3 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">Use GPS Location</span>
                    </div>
                    {gpsLocation ? (
                      <div className="flex items-center gap-1 text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-xs">Captured</span>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleGetGpsLocation}
                        disabled={geoLoading || waitingForGps === 'new'}
                      >
                        {(geoLoading || waitingForGps === 'new') && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        Get Location
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    For accurate delivery fee calculation
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Label</Label>
                  <div className="flex gap-2">
                    {['Home', 'Work', 'Other'].map((label) => (
                      <Button
                        key={label}
                        type="button"
                        variant={formData.label === label ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setFormData({ ...formData, label })}
                        className="flex-1 gap-2"
                      >
                        {labelIcons[label]}
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address_line">Street Address *</Label>
                  <Input
                    id="address_line"
                    value={formData.address_line}
                    onChange={(e) => setFormData({ ...formData, address_line: e.target.value })}
                    placeholder="123 Main Street, Lekki"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City *</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="Lagos"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State *</Label>
                    <Input
                      id="state"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      placeholder="Lagos"
                    />
                  </div>
                </div>

                <Button className="w-full" onClick={handleAddAddress} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Add Address
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button className="w-full flex items-center gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors text-left">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  {selectedAddress ? (
                    labelIcons[selectedAddress.label] || <MapPin className="w-5 h-5 text-primary" />
                  ) : (
                    <MapPin className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {selectedAddress ? (
                    <>
                      <p className="font-medium text-foreground">{selectedAddress.label}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {selectedAddress.address_line}, {selectedAddress.city}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Select delivery address</p>
                  )}
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Delivery Address</DialogTitle>
              </DialogHeader>
              <RadioGroup
                value={selectedAddress?.id || ''}
                onValueChange={(id) => {
                  const addr = addresses.find(a => a.id === id);
                  if (addr) {
                    onSelect(addr);
                    setIsOpen(false);
                  }
                }}
                className="space-y-3 pt-4"
              >
                {addresses.map((address) => (
                  <div
                    key={address.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors"
                  >
                    <label className="flex items-start gap-3 flex-1 cursor-pointer">
                      <RadioGroupItem value={address.id} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {labelIcons[address.label] || <MapPin className="w-4 h-4" />}
                          <span className="font-medium text-foreground">{address.label}</span>
                          {address.latitude && address.longitude && (
                            <CheckCircle className="w-3 h-3 text-green-600" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {address.address_line}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {address.city}, {address.state}
                        </p>
                      </div>
                    </label>
                    {/* GPS update/refresh button - always show so users can fix wrong coordinates */}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdateAddressGps(address.id);
                      }}
                      disabled={updatingGps === address.id}
                      className="shrink-0"
                      title={address.latitude ? "Refresh GPS location" : "Set GPS location"}
                    >
                      {updatingGps === address.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Navigation className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </RadioGroup>
              
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full mt-4 gap-2">
                    <Plus className="w-4 h-4" />
                    Add New Address
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Address</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    {/* GPS Location Button */}
                    <div className="p-3 rounded-lg bg-secondary/50 border border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Navigation className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Use GPS Location</span>
                        </div>
                        {gpsLocation ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs">Captured</span>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleGetGpsLocation}
                            disabled={geoLoading || waitingForGps === 'new'}
                          >
                            {(geoLoading || waitingForGps === 'new') && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                            Get Location
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        For accurate delivery fee calculation
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Label</Label>
                      <div className="flex gap-2">
                        {['Home', 'Work', 'Other'].map((label) => (
                          <Button
                            key={label}
                            type="button"
                            variant={formData.label === label ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setFormData({ ...formData, label })}
                            className="flex-1 gap-2"
                          >
                            {labelIcons[label]}
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address_line_modal">Street Address *</Label>
                      <Input
                        id="address_line_modal"
                        value={formData.address_line}
                        onChange={(e) => setFormData({ ...formData, address_line: e.target.value })}
                        placeholder="123 Main Street, Lekki"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="city_modal">City *</Label>
                        <Input
                          id="city_modal"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          placeholder="Lagos"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state_modal">State *</Label>
                        <Input
                          id="state_modal"
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                          placeholder="Lagos"
                        />
                      </div>
                    </div>

                    <Button className="w-full" onClick={handleAddAddress} disabled={saving}>
                      {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Add Address
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
