import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Save, Loader2, Bike, Users, Building2, Navigation, CheckCircle, Clock, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { GeoLockBanner } from '@/components/vendor/GeoLockBanner';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useVendorResolver } from '@/hooks/useVendorResolver';
import { useOutletContext } from '@/hooks/useOutletContext';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

function VendorStoreSettingsInner() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { vendorId, loading: vendorLoading } = useVendorResolver();
  const { selectedOutlet, refreshOutlets } = useOutletContext();
  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendorId);
  const { latitude: geoLat, longitude: geoLon, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();
  
  const [saving, setSaving] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [vendorName, setVendorName] = useState('');

  const [formData, setFormData] = useState({
    outlet_name: '',
    outlet_surname: '',
    address: '',
    city: '',
    state: '',
    delivery_mode: 'platform',
    own_rider_priority: true,
    min_order_amount: '0',
    estimated_delivery_minutes: '30',
  });

  // Fetch vendor name
  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('name').eq('id', vendorId).single()
      .then(({ data }) => { if (data) setVendorName(data.name); });
  }, [vendorId]);

  // Load outlet data into form
  useEffect(() => {
    if (!selectedOutlet) return;
    setFormData({
      outlet_name: selectedOutlet.outlet_name || '',
      outlet_surname: selectedOutlet.outlet_surname || '',
      address: selectedOutlet.address || '',
      city: selectedOutlet.city || '',
      state: selectedOutlet.state || '',
      delivery_mode: selectedOutlet.delivery_mode || 'platform',
      own_rider_priority: true,
      min_order_amount: selectedOutlet.min_order_amount?.toString() || '0',
      estimated_delivery_minutes: selectedOutlet.estimated_delivery_minutes?.toString() || '30',
    });
  }, [selectedOutlet?.id]);

  useEffect(() => {
    if (!authLoading && !user) navigate('/vendor/auth');
  }, [user, authLoading]);

  const handleSave = async () => {
    if (!selectedOutlet) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('vendor_outlets')
        .update({
          outlet_name: formData.outlet_name,
          outlet_surname: formData.outlet_surname,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          delivery_mode: formData.delivery_mode,
          min_order_amount: parseFloat(formData.min_order_amount) || 0,
          estimated_delivery_minutes: parseInt(formData.estimated_delivery_minutes) || 30,
        })
        .eq('id', selectedOutlet.id);

      if (error) throw error;
      toast({ title: 'Store settings saved' });
      await refreshOutlets();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = authLoading || vendorLoading || permLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (!hasPermission('edit_settings')) {
    return <AccessDenied message="You don't have permission to edit store settings." />;
  }

  return (
    <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Settings2 className="w-6 h-6" />
                Store Settings
              </h1>
              <p className="text-muted-foreground">
                Configure settings for: {selectedOutlet?.outlet_name}
                {selectedOutlet?.outlet_surname ? ` – ${selectedOutlet.outlet_surname}` : ''}
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-2 w-fit">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Outlet Identity */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                Outlet Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Outlet Name</Label>
                  <Input
                    value={formData.outlet_name}
                    onChange={e => setFormData({ ...formData, outlet_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Branch Tag (Surname)</Label>
                  <Input
                    value={formData.outlet_surname}
                    onChange={e => setFormData({ ...formData, outlet_surname: e.target.value })}
                    placeholder="e.g. Ikeja"
                  />
                  <p className="text-xs text-muted-foreground">
                    Displays as: {vendorName} – {formData.outlet_surname || 'Branch'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Outlet Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GPS */}
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Precise GPS Location</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedOutlet?.latitude && selectedOutlet?.longitude
                        ? `📍 Saved: ${selectedOutlet.latitude.toFixed(4)}, ${selectedOutlet.longitude.toFixed(4)}`
                        : 'Set exact location for accurate delivery distances'}
                    </p>
                  </div>
                  {selectedOutlet?.latitude && selectedOutlet?.longitude && (
                    <CheckCircle className="w-5 h-5 text-success shrink-0" />
                  )}
                </div>
                <Button
                  variant={selectedOutlet?.latitude ? 'outline' : 'default'}
                  size="sm"
                  className="gap-2"
                  onClick={async () => {
                    setGettingLocation(true);
                    getCurrentPosition();
                  }}
                  disabled={geoLoading || gettingLocation}
                >
                  {(geoLoading || gettingLocation) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Navigation className="w-4 h-4" />
                  )}
                  {selectedOutlet?.latitude ? 'Update Location' : 'Use Current Location'}
                </Button>
              </div>

              {/* Auto-save GPS */}
              {gettingLocation && geoLat && geoLon && selectedOutlet && (
                <GpsAutoSaveOutlet
                  outletId={selectedOutlet.id}
                  lat={geoLat}
                  lon={geoLon}
                  onComplete={() => {
                    setGettingLocation(false);
                    toast({ title: 'Location saved' });
                    refreshOutlets();
                  }}
                  onError={(err) => {
                    setGettingLocation(false);
                    toast({ title: 'Error', description: err, variant: 'destructive' });
                  }}
                />
              )}

              <div className="space-y-2">
                <Label>Street Address</Label>
                <Input
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input
                    value={formData.city}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input
                    value={formData.state}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Delivery Mode */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bike className="w-5 h-5" />
                Delivery Mode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup
                value={formData.delivery_mode}
                onValueChange={val => setFormData({ ...formData, delivery_mode: val })}
                className="grid gap-4"
              >
                <div className="flex items-start space-x-3 p-4 rounded-xl border border-border hover:border-primary/50 transition-colors">
                  <RadioGroupItem value="own" id="own" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="own" className="flex items-center gap-2 cursor-pointer font-medium">
                      <Users className="w-4 h-4 text-primary" />
                      My Own Riders Only
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Only your in-house delivery staff will handle orders
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-4 rounded-xl border border-border hover:border-primary/50 transition-colors">
                  <RadioGroupItem value="platform" id="platform" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="platform" className="flex items-center gap-2 cursor-pointer font-medium">
                      <Building2 className="w-4 h-4 text-primary" />
                      Platform Riders Only
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Platform riders will handle all deliveries
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-4 rounded-xl border border-border hover:border-primary/50 transition-colors">
                  <RadioGroupItem value="both" id="both" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="both" className="flex items-center gap-2 cursor-pointer font-medium">
                      <Bike className="w-4 h-4 text-primary" />
                      Both (With Priority)
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Use both your riders and platform riders with priority settings
                    </p>
                  </div>
                </div>
              </RadioGroup>

              {formData.delivery_mode === 'both' && (
                <div className="p-4 bg-muted/50 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">Prioritize My Riders</Label>
                      <p className="text-sm text-muted-foreground">
                        Try your riders first before platform riders
                      </p>
                    </div>
                    <Switch
                      checked={formData.own_rider_priority}
                      onCheckedChange={checked => setFormData({ ...formData, own_rider_priority: checked })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Store Status */}
          {selectedOutlet && (
            <Card className="border-0 shadow-soft">
              <CardHeader>
                <CardTitle className="text-lg">Store Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
                  <div>
                    <p className="font-medium text-foreground">Open / Closed</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedOutlet.is_open ? 'This outlet is currently accepting orders' : 'This outlet is closed'}
                    </p>
                  </div>
                  <Switch
                    checked={selectedOutlet.is_open ?? false}
                    onCheckedChange={async (checked) => {
                      await supabase.from('vendor_outlets').update({ is_open: checked }).eq('id', selectedOutlet.id);
                      await refreshOutlets();
                      toast({ title: checked ? 'Outlet opened' : 'Outlet closed' });
                    }}
                  />
                </div>
                {!selectedOutlet.is_approved && (
                  <div className="p-4 bg-warning/10 border border-warning/30 rounded-xl">
                    <p className="text-sm font-medium text-warning flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Pending Admin Approval
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This outlet cannot accept orders until approved by an administrator.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Geo-Lock */}
          {selectedOutlet && (selectedOutlet as any).geo_lock_status === 'locked' && (
            <GeoLockBanner
              vendorId={vendorId || ''}
              geoStatus="locked_pending_reverify"
              lockReason={(selectedOutlet as any).geo_lock_reason}
              lockedAt={null}
              onStatusChange={refreshOutlets}
            />
          )}
        </div>
  );
}

export default function VendorStoreSettings() {
  const { vendorId, loading } = useVendorResolver();
  const [vendorName, setVendorName] = useState('');

  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('name').eq('id', vendorId).single()
      .then(({ data }) => { if (data) setVendorName(data.name); });
  }, [vendorId]);

  return (
    <VendorLayout vendorName={vendorName} vendorId={vendorId || undefined}>
      <VendorStoreSettingsInner />
    </VendorLayout>
  );
}

// Auto-save GPS for outlet
function GpsAutoSaveOutlet({ outletId, lat, lon, onComplete, onError }: {
  outletId: string; lat: number; lon: number; onComplete: () => void; onError: (msg: string) => void;
}) {
  useEffect(() => {
    if (!outletId || !lat || !lon) return;
    const save = async () => {
      try {
        const { error } = await supabase
          .from('vendor_outlets')
          .update({ latitude: lat, longitude: lon })
          .eq('id', outletId);
        if (error) throw error;
        onComplete();
      } catch {
        onError('Failed to save location');
      }
    };
    save();
  }, [outletId, lat, lon]);

  return null;
}
