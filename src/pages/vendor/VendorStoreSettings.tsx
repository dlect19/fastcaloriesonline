import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Save, Loader2, Bike, Users, Building2, Navigation, CheckCircle, Clock, Settings2, Megaphone, Heart, QrCode, Radar, Trash2, Search, Share2 } from 'lucide-react';
import { StoreTypeField, type StoreType, type SocialMediaHandles } from '@/components/vendor/StoreTypeField';
import { SocialMediaMarketingBanner } from '@/components/vendor/SocialMediaMarketingBanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { GeoLockBanner } from '@/components/vendor/GeoLockBanner';
import { MarketingBanner } from '@/components/vendor/MarketingBanner';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useVendorResolver } from '@/hooks/useVendorResolver';
import { useOutletContext } from '@/hooks/useOutletContext';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { MapLocationPicker } from '@/components/shared/MapLocationPicker';

function VendorStoreSettingsInner() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { vendorId, loading: vendorLoading } = useVendorResolver();
  const { selectedOutlet, outlets, refreshOutlets } = useOutletContext();
  const { hasPermission, loading: permLoading } = useVendorPermissions(vendorId);
  const { latitude: geoLat, longitude: geoLon, loading: geoLoading, getCurrentPosition } = useGeolocation();
  
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [vendorName, setVendorName] = useState('');
  const [vendorData, setVendorData] = useState<{ logo_url: string | null } | null>(null);
  const [maxSalesRadius, setMaxSalesRadius] = useState(50);
  const [deletingOutlet, setDeletingOutlet] = useState(false);
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
      if (data?.latitude && data?.longitude && selectedOutlet) {
        const { error } = await supabase
          .from('vendor_outlets')
          .update({ latitude: data.latitude, longitude: data.longitude })
          .eq('id', selectedOutlet.id);
        if (error) throw error;
        setAddressQuery(data.formatted_address || '');
        toast({ title: 'Location set', description: `📍 ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}` });
        await refreshOutlets();
      } else {
        toast({ title: 'Could not resolve coordinates', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Lookup failed', variant: 'destructive' });
    }
    setSearchLoading(false);
    sessionTokenRef.current = crypto.randomUUID();
  };

  const [outletStoreType, setOutletStoreType] = useState<StoreType>('physical');
  const [outletSocialHandles, setOutletSocialHandles] = useState<SocialMediaHandles>({});

  const [formData, setFormData] = useState({
    outlet_name: '',
    outlet_surname: '',
    address: '',
    city: '',
    state: '',
    delivery_mode: 'platform',
    own_rider_priority: true,
    sales_radius: 10,
  });

  // Fetch vendor name + logo + max radius
  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('name, logo_url').eq('id', vendorId).single()
      .then(({ data }) => { 
        if (data) {
          setVendorName(data.name);
          setVendorData(data);
        }
      });
    
    // Fetch platform max sales radius threshold
    supabase.from('platform_settings').select('value').eq('key', 'vendor_delivery_radius_km').single()
      .then(({ data }) => {
        if (data) setMaxSalesRadius(Math.min(50, Math.max(1, parseFloat(data.value) || 50)));
      });
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
      sales_radius: (selectedOutlet as any).sales_radius || 10,
    });
    setOutletStoreType(((selectedOutlet as any).store_type as StoreType) || 'physical');
    setOutletSocialHandles(((selectedOutlet as any).social_media_handles as SocialMediaHandles) || {});
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
          sales_radius: Math.min(maxSalesRadius, Math.max(1, formData.sales_radius)),
          store_type: outletStoreType,
          social_media_handles: outletSocialHandles,
        } as any)
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

  const handleDeleteOutlet = async () => {
    if (!selectedOutlet) return;
    if (selectedOutlet.is_default) {
      toast({ title: 'Cannot delete', description: 'You cannot delete the default outlet.', variant: 'destructive' });
      return;
    }
    setDeletingOutlet(true);
    try {
      const { error } = await supabase
        .from('vendor_outlets')
        .delete()
        .eq('id', selectedOutlet.id);

      if (error) throw error;
      toast({ title: 'Outlet deleted' });
      await refreshOutlets();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingOutlet(false);
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

  const outletDisplayName = `${vendorName} – ${selectedOutlet?.outlet_surname || 'Branch'}`;

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
            Configure settings for: {outletDisplayName}
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

      {/* Store Type & Social Media */}
      <Card className="border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Store Type & Social Media
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StoreTypeField
            storeType={outletStoreType}
            onStoreTypeChange={setOutletStoreType}
            socialHandles={outletSocialHandles}
            onSocialHandlesChange={setOutletSocialHandles}
          />
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
          {/* Search Address */}
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

          {/* Map Picker */}
          <div className="space-y-2">
            <Label>Pick on Map</Label>
            <MapLocationPicker
              latitude={selectedOutlet?.latitude ?? undefined}
              longitude={selectedOutlet?.longitude ?? undefined}
              onLocationSelect={async (lat, lng) => {
                if (!selectedOutlet) return;
                try {
                  const { error } = await supabase
                    .from('vendor_outlets')
                    .update({ latitude: lat, longitude: lng })
                    .eq('id', selectedOutlet.id);
                  if (error) throw error;
                  toast({ title: 'Location updated', description: `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}` });
                  await refreshOutlets();
                } catch {
                  toast({ title: 'Failed to save location', variant: 'destructive' });
                }
              }}
              height="250px"
            />
            <p className="text-xs text-muted-foreground">Click on the map or drag the marker to set location</p>
          </div>

          {/* GPS & Address Geocode buttons */}
          <div className="relative flex items-center gap-2 py-1">
            <div className="flex-1 border-t" />
            <span className="text-xs text-muted-foreground">or use other methods</span>
            <div className="flex-1 border-t" />
          </div>

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
                <CheckCircle className="w-5 h-5 text-primary shrink-0" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
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
                {selectedOutlet?.latitude ? 'Update via GPS' : 'Use Current GPS'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={async () => {
                  if (!formData.address.trim() || !formData.city.trim()) {
                    toast({ title: 'Missing Info', description: 'Enter street address and city below first.', variant: 'destructive' });
                    return;
                  }
                  if (!selectedOutlet) return;
                  setGeocodingAddress(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('geocode-address', {
                      body: {
                        address: formData.address,
                        city: formData.city,
                        state: formData.state || 'Lagos',
                        country: 'Nigeria',
                      },
                    });
                    if (error || data?.error) throw new Error(data?.error || 'Geocoding failed');
                    const { error: updateErr } = await supabase
                      .from('vendor_outlets')
                      .update({ latitude: data.latitude, longitude: data.longitude })
                      .eq('id', selectedOutlet.id);
                    if (updateErr) throw updateErr;
                    toast({ title: 'Location set from address', description: `📍 ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}` });
                    await refreshOutlets();
                  } catch (err: any) {
                    toast({ title: 'Address not found', description: 'Could not geocode that address. Try a more specific location.', variant: 'destructive' });
                  } finally {
                    setGeocodingAddress(false);
                  }
                }}
                disabled={geocodingAddress}
              >
                {geocodingAddress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Set from Address
              </Button>
            </div>
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

      {/* Delivery Coverage — hidden for online-only outlets */}
      {outletStoreType !== 'online' && (
      <Card className="border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Radar className="w-5 h-5" />
            Delivery Coverage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set how far customers can see and order from this outlet. Maximum allowed: {maxSalesRadius}km.
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Sales Radius</Label>
              <span className="text-sm font-semibold text-primary">{formData.sales_radius} km</span>
            </div>
            <Slider
              value={[formData.sales_radius]}
              onValueChange={([val]) => setFormData({ ...formData, sales_radius: val })}
              min={1}
              max={maxSalesRadius}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 km</span>
              <span>{maxSalesRadius} km</span>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Marketing Materials — physical/both outlets */}
      {selectedOutlet && outletStoreType !== 'online' && (
        <Card className="border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Megaphone className="w-5 h-5" />
              Marketing Materials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate printable marketing banners with QR codes for this outlet.
            </p>
            <MarketingBanner
              vendor={{
                id: selectedOutlet.id,
                name: outletDisplayName,
                address: selectedOutlet.address || '',
                city: selectedOutlet.city || '',
                state: selectedOutlet.state || '',
                logo_url: vendorData?.logo_url || null,
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Social Media Marketing Card — online/both outlets */}
      {selectedOutlet && vendorId && (outletStoreType === 'online' || outletStoreType === 'both') && (
        <Card className="border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Share2 className="w-5 h-5" />
              Social Media Marketing Card
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SocialMediaMarketingBanner
              vendorName={vendorName}
              outletDisplayName={outletDisplayName}
              logoUrl={vendorData?.logo_url || null}
              socialHandles={outletSocialHandles}
              vendorId={vendorId}
              outletId={selectedOutlet.id}
            />
          </CardContent>
        </Card>
      )}

      {/* Customer Favorites QR Code */}
      {selectedOutlet && vendorId && (
        <Card className="border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Heart className="w-5 h-5 text-destructive" />
              Customer Favorites QR Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Display this QR code at this outlet. When customers scan it, they can instantly add your store to their favorites.
            </p>
            <div className="flex flex-col items-center gap-4 p-4 bg-muted/50 rounded-xl">
              <div className="p-4 bg-background rounded-lg shadow-sm">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}/vendor/${vendorId}?action=favorite`)}`}
                  alt="Favorites QR Code"
                  className="w-48 h-48"
                />
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">Scan to Favorite</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {outletDisplayName}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`${window.location.origin}/vendor/${vendorId}?action=favorite`)}`;
                  link.download = `${outletDisplayName.replace(/\s+/g, '-')}-favorites-qr.png`;
                  link.click();
                }}
              >
                <QrCode className="w-4 h-4" />
                Download QR Code
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Geo-Lock */}
      {selectedOutlet && (selectedOutlet as any).geo_verification_status === 'locked_pending_reverify' && (
        <GeoLockBanner
          vendorId={vendorId || ''}
          geoStatus="locked_pending_reverify"
          lockReason={(selectedOutlet as any).geo_lock_reason}
          lockedAt={null}
          onStatusChange={refreshOutlets}
        />
      )}

      {/* Delete Outlet */}
      {selectedOutlet && !selectedOutlet.is_default && outlets.length > 1 && (
        <Card className="border-destructive/30">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Permanently delete this outlet ({outletDisplayName}). This cannot be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2">
                  <Trash2 className="w-4 h-4" />
                  Delete Outlet
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {outletDisplayName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this outlet and all its associated data including orders, earnings, and staff assignments. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteOutlet}
                    disabled={deletingOutlet}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deletingOutlet ? 'Deleting...' : 'Delete Outlet'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
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
