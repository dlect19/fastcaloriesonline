import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAndUpdateAddress } from '@/lib/geocoding';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Plus, Home, Briefcase, ChevronRight, Loader2 } from 'lucide-react';
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
  const [isOpen, setIsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    label: 'Home',
    address_line: '',
    city: '',
    state: '',
  });

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
      const { data, error } = await supabase
        .from('addresses')
        .insert({
          user_id: userId,
          label: formData.label,
          address_line: formData.address_line.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          is_default: addresses.length === 0,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Address added successfully. Calculating location...',
      });
      setIsAddOpen(false);
      setFormData({ label: 'Home', address_line: '', city: '', state: '' });
      onAddressAdded();
      
      // Auto-select the new address
      if (data) {
        onSelect(data);
        
        // Geocode in background and update with coordinates
        geocodeAndUpdateAddress(data.id, data.address_line, data.city, data.state)
          .then((result) => {
            if (result) {
              // Update the selected address with coordinates for immediate delivery fee calculation
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
                  <label
                    key={address.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/50 cursor-pointer transition-colors"
                  >
                    <RadioGroupItem value={address.id} className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {labelIcons[address.label] || <MapPin className="w-4 h-4" />}
                        <span className="font-medium text-foreground">{address.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {address.address_line}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {address.city}, {address.state}
                      </p>
                    </div>
                  </label>
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
