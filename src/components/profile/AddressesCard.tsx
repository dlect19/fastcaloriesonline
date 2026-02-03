import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddressWithSuggestions, updateAddressCoordinates, type GeocodeSuggestion } from '@/lib/geocoding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MapPin, Plus, Home, Briefcase, Star, Trash2, Loader2, Pencil, Navigation } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Address = Tables<'addresses'>;

interface AddressesCardProps {
  addresses: Address[];
  userId: string;
  onUpdate: () => void;
}

const labelIcons: Record<string, React.ReactNode> = {
  Home: <Home className="w-4 h-4" />,
  Work: <Briefcase className="w-4 h-4" />,
  Other: <MapPin className="w-4 h-4" />,
};

export function AddressesCard({ addresses, userId, onUpdate }: AddressesCardProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingAddressId, setPendingAddressId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    label: 'Home',
    address_line: '',
    city: '',
    state: '',
  });

  const resetForm = () => {
    setFormData({ label: 'Home', address_line: '', city: '', state: '' });
    setEditingAddress(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setPendingAddressId(null);
  };

  const openAddDialog = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEditDialog = (address: Address) => {
    setEditingAddress(address);
    setFormData({
      label: address.label,
      address_line: address.address_line,
      city: address.city,
      state: address.state,
    });
    setSuggestions([]);
    setShowSuggestions(false);
    setIsOpen(true);
  };

  const handleCloseDialog = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    setIsOpen(open);
  };

  const handleSelectSuggestion = async (suggestion: GeocodeSuggestion) => {
    if (!pendingAddressId) return;
    
    setSaving(true);
    try {
      // Update the address with the selected suggestion's coordinates
      await updateAddressCoordinates(pendingAddressId, suggestion.latitude, suggestion.longitude);
      
      toast({
        title: 'Location Set',
        description: `Using: ${suggestion.display_name}`,
      });
      
      setShowSuggestions(false);
      setSuggestions([]);
      setPendingAddressId(null);
      setIsOpen(false);
      resetForm();
      onUpdate();
    } catch (error) {
      console.error('Error setting location:', error);
      toast({
        title: 'Error',
        description: 'Failed to set location',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAddress = async () => {
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
      let addressId: string;
      
      if (editingAddress) {
        // Update existing address
        const { error } = await supabase
          .from('addresses')
          .update({
            label: formData.label,
            address_line: formData.address_line.trim(),
            city: formData.city.trim(),
            state: formData.state.trim(),
            latitude: null,
            longitude: null,
          })
          .eq('id', editingAddress.id);

        if (error) throw error;
        addressId = editingAddress.id;
      } else {
        // Add new address
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
        addressId = data.id;
      }

      // Try to geocode the address
      const { result, suggestions: geocodeSuggestions } = await geocodeAddressWithSuggestions(
        formData.address_line.trim(),
        formData.city.trim(),
        formData.state.trim()
      );

      if (result) {
        // Exact match found - update coordinates
        await updateAddressCoordinates(addressId, result.latitude, result.longitude);
        
        toast({
          title: 'Success',
          description: 'Address saved with location!',
        });
        
        setIsOpen(false);
        resetForm();
        onUpdate();
      } else if (geocodeSuggestions.length > 0) {
        // No exact match - show suggestions
        setPendingAddressId(addressId);
        setSuggestions(geocodeSuggestions);
        setShowSuggestions(true);
        
        toast({
          title: 'Address Saved',
          description: 'Please select a nearby location to set coordinates.',
        });
        onUpdate();
      } else {
        // No suggestions either - address saved without coordinates
        toast({
          title: 'Address Saved',
          description: 'Location not found. You can set GPS manually later.',
        });
        
        setIsOpen(false);
        resetForm();
        onUpdate();
      }
    } catch (error) {
      console.error('Error saving address:', error);
      toast({
        title: 'Error',
        description: editingAddress ? 'Failed to update address' : 'Failed to add address',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    setDeleting(addressId);
    try {
      const { error } = await supabase
        .from('addresses')
        .delete()
        .eq('id', addressId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Address deleted',
      });
      onUpdate();
    } catch (error) {
      console.error('Error deleting address:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete address',
        variant: 'destructive',
      });
    } finally {
      setDeleting(null);
    }
  };

  const handleSetDefault = async (addressId: string) => {
    try {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId);

      const { error } = await supabase
        .from('addresses')
        .update({ is_default: true })
        .eq('id', addressId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Default address updated',
      });
      onUpdate();
    } catch (error) {
      console.error('Error setting default:', error);
      toast({
        title: 'Error',
        description: 'Failed to update default address',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          Saved Addresses
        </CardTitle>
        <Dialog open={isOpen} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1" onClick={openAddDialog}>
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {showSuggestions 
                  ? 'Select Nearby Location' 
                  : editingAddress 
                    ? 'Edit Address' 
                    : 'Add New Address'}
              </DialogTitle>
            </DialogHeader>
            
            {showSuggestions ? (
              <div className="space-y-3 pt-4">
                <p className="text-sm text-muted-foreground">
                  We couldn't find the exact address. Did you mean one of these nearby locations?
                </p>
                <div className="space-y-2">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSelectSuggestion(suggestion)}
                      disabled={saving}
                      className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-left"
                    >
                      <Navigation className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm">{suggestion.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {suggestion.display_name}
                        </p>
                        {suggestion.city && (
                          <p className="text-xs text-muted-foreground">
                            {suggestion.city}{suggestion.state ? `, ${suggestion.state}` : ''}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => {
                    setShowSuggestions(false);
                    setSuggestions([]);
                    setIsOpen(false);
                    resetForm();
                  }}
                >
                  Skip - I'll set GPS manually
                </Button>
              </div>
            ) : (
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
                    placeholder="e.g. 2 Jamiu Balogun, Ikosi Ketu"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City *</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="Ikeja"
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

                <Button className="w-full" onClick={handleSaveAddress} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingAddress ? 'Update Address' : 'Add Address'}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-secondary flex items-center justify-center">
              <MapPin className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No saved addresses</p>
            <p className="text-sm text-muted-foreground mt-1">Add an address for faster checkout</p>
          </div>
        ) : (
          <div className="space-y-3">
            {addresses.map((address) => (
              <div
                key={address.id}
                className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  {labelIcons[address.label] || <MapPin className="w-5 h-5 text-primary" />}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{address.label}</p>
                    {address.is_default && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        <Star className="w-3 h-3 fill-current" />
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {address.address_line}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {address.city}, {address.state}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={() => openEditDialog(address)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  {!address.is_default && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => handleSetDefault(address.id)}
                    >
                      <Star className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteAddress(address.id)}
                    disabled={deleting === address.id}
                  >
                    {deleting === address.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
