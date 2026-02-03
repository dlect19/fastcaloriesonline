import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAndUpdateAddress } from '@/lib/geocoding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MapPin, Plus, Home, Briefcase, Star, Trash2, Loader2 } from 'lucide-react';
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
        description: 'Address added. Finding location...',
      });
      
      // Geocode in background
      if (data) {
        geocodeAndUpdateAddress(data.id, formData.address_line.trim(), formData.city.trim(), formData.state.trim())
          .then((result) => {
            if (result) {
              toast({
                title: 'Location Found',
                description: 'Your address location has been saved.',
              });
            }
            onUpdate();
          })
          .catch(() => {
            onUpdate();
          });
      } else {
        onUpdate();
      }
      
      setIsOpen(false);
      setFormData({ label: 'Home', address_line: '', city: '', state: '' });
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
      // First, unset all defaults
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId);

      // Then set the new default
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
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              Add
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
