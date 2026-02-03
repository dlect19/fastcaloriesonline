import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Mail, Phone, MapPin, Save, Camera, ImageIcon, Loader2, Megaphone, Bike, Users, Building2, Heart, QrCode, Navigation, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { MarketingBanner } from '@/components/vendor/MarketingBanner';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAndUpdateVendor } from '@/lib/geocoding';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

export default function VendorSettings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);
  const { latitude: geoLat, longitude: geoLon, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();
  const [gettingLocation, setGettingLocation] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    min_order_amount: '',
    delivery_fee: '',
    estimated_delivery_minutes: '',
    logo_url: '',
    banner_url: '',
    delivery_mode: 'platform',
    own_rider_priority: true,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      // Use limit(1) to handle multiple vendor profiles
      const { data: vendorResults } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const vendorData = vendorResults?.[0] || null;
      setVendor(vendorData);

      if (vendorData) {
        setFormData({
          name: vendorData.name,
          description: vendorData.description || '',
          phone: vendorData.phone || '',
          email: vendorData.email || '',
          address: vendorData.address,
          city: vendorData.city,
          state: vendorData.state,
          min_order_amount: vendorData.min_order_amount?.toString() || '0',
          delivery_fee: vendorData.delivery_fee?.toString() || '0',
          estimated_delivery_minutes: vendorData.estimated_delivery_minutes?.toString() || '30',
          logo_url: vendorData.logo_url || '',
          banner_url: vendorData.banner_url || '',
          delivery_mode: vendorData.delivery_mode || 'platform',
          own_rider_priority: vendorData.own_rider_priority ?? true,
        });
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file: File, type: 'logo' | 'banner') => {
    if (!user || !vendor) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${type}-${Date.now()}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('vendor-assets')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('vendor-assets')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 2MB',
        variant: 'destructive',
      });
      return;
    }

    setUploadingLogo(true);
    try {
      const url = await uploadImage(file, 'logo');
      if (url) {
        setFormData({ ...formData, logo_url: url });
        toast({ title: 'Logo uploaded successfully' });
      }
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }

    setUploadingBanner(true);
    try {
      const url = await uploadImage(file, 'banner');
      if (url) {
        setFormData({ ...formData, banner_url: url });
        toast({ title: 'Banner uploaded successfully' });
      }
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSave = async () => {
    if (!vendor) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('vendors')
        .update({
          name: formData.name,
          description: formData.description || null,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          min_order_amount: parseFloat(formData.min_order_amount) || 0,
          delivery_fee: parseFloat(formData.delivery_fee) || 0,
          estimated_delivery_minutes: parseInt(formData.estimated_delivery_minutes) || 30,
          logo_url: formData.logo_url || null,
          banner_url: formData.banner_url || null,
          delivery_mode: formData.delivery_mode,
          own_rider_priority: formData.own_rider_priority,
        })
        .eq('id', vendor.id);

      if (error) throw error;

      toast({ title: 'Settings saved successfully' });
      
      // Only geocode if vendor doesn't already have GPS coordinates
      // GPS coordinates are more accurate than text-based geocoding
      if (!vendor.latitude || !vendor.longitude) {
        geocodeAndUpdateVendor(vendor.id, formData.address, formData.city, formData.state)
          .then((result) => {
            if (result) {
              toast({ 
                title: 'Location Updated',
                description: 'Your business location has been geocoded for accurate delivery fees.',
              });
            }
          })
          .catch((err) => {
            console.error('Vendor geocoding failed:', err);
          });
      }
      
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error saving settings',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || permLoading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </main>
      </div>
    );
  }

  if (!hasPermission('edit_settings')) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor?.name} permissions={permissions} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied message="You don't have permission to edit settings." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} permissions={permissions} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Settings</h1>
              <p className="text-muted-foreground">Manage your business profile</p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-2 w-fit">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Logo & Banner Upload */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Brand Assets
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo Upload */}
              <div className="space-y-3">
                <Label>Business Logo</Label>
                <div className="flex items-center gap-4">
                  <div 
                    className="w-24 h-24 rounded-2xl bg-muted flex items-center justify-center overflow-hidden border-2 border-dashed border-border cursor-pointer hover:border-primary transition-colors"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {uploadingLogo ? (
                      <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                    ) : formData.logo_url ? (
                      <img src={formData.logo_url} alt="Logo" className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload your business logo. Recommended: 400x400px, max 2MB.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingLogo}
                    >
                      {uploadingLogo ? 'Uploading...' : 'Choose Logo'}
                    </Button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </div>
                </div>
              </div>

              {/* Banner Upload */}
              <div className="space-y-3">
                <Label>Cover Banner</Label>
                <div 
                  className="w-full h-40 rounded-2xl bg-muted flex items-center justify-center overflow-hidden border-2 border-dashed border-border cursor-pointer hover:border-primary transition-colors"
                  onClick={() => bannerInputRef.current?.click()}
                >
                  {uploadingBanner ? (
                    <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                  ) : formData.banner_url ? (
                    <img src={formData.banner_url} alt="Banner" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center">
                      <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Click to upload banner</p>
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Recommended: 1200x400px, max 5MB. This appears at the top of your store page.
                </p>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleBannerUpload}
                />
              </div>
            </CardContent>
          </Card>

          {/* Business Info */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Store className="w-5 h-5" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Business Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="08012345678"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  placeholder="Tell customers about your business..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GPS Location Button */}
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Precise GPS Location</p>
                    <p className="text-sm text-muted-foreground">
                      {vendor?.latitude && vendor?.longitude 
                        ? `📍 Saved: ${vendor.latitude.toFixed(4)}, ${vendor.longitude.toFixed(4)}`
                        : 'Set your exact location for accurate delivery distances'}
                    </p>
                  </div>
                  {vendor?.latitude && vendor?.longitude && (
                    <CheckCircle className="w-5 h-5 text-calorie-low shrink-0" />
                  )}
                </div>
                <Button
                  variant={vendor?.latitude ? "outline" : "default"}
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
                  {vendor?.latitude ? 'Update My Location' : 'Use My Current Location'}
                </Button>
                {geoError && (
                  <p className="text-xs text-destructive">{geoError}</p>
                )}
              </div>

              {/* Auto-save GPS when obtained */}
              {gettingLocation && geoLat && geoLon && (
                <GpsAutoSave 
                  vendorId={vendor?.id || ''} 
                  lat={geoLat} 
                  lon={geoLon} 
                  onComplete={() => {
                    setGettingLocation(false);
                    toast({ title: 'Location Updated', description: 'Your precise GPS location has been saved.' });
                    fetchData();
                  }}
                  onError={(err) => {
                    setGettingLocation(false);
                    toast({ title: 'Error', description: err, variant: 'destructive' });
                  }}
                />
              )}

              <div className="space-y-2">
                <Label htmlFor="address">Street Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Delivery Settings */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bike className="w-5 h-5" />
                Delivery Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min_order">Minimum Order (₦)</Label>
                  <Input
                    id="min_order"
                    type="number"
                    value={formData.min_order_amount}
                    onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delivery_fee">Delivery Fee (₦)</Label>
                  <Input
                    id="delivery_fee"
                    type="number"
                    value={formData.delivery_fee}
                    onChange={(e) => setFormData({ ...formData, delivery_fee: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delivery_time">Est. Delivery (mins)</Label>
                  <Input
                    id="delivery_time"
                    type="number"
                    value={formData.estimated_delivery_minutes}
                    onChange={(e) => setFormData({ ...formData, estimated_delivery_minutes: e.target.value })}
                  />
                </div>
              </div>

              {/* Delivery Mode Selection */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div>
                  <Label className="text-base font-medium">Delivery Mode</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Choose how orders are delivered to your customers
                  </p>
                </div>
                <RadioGroup
                  value={formData.delivery_mode}
                  onValueChange={(val) => setFormData({ ...formData, delivery_mode: val })}
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
                        Fast Calories Riders Only
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Platform riders will handle all your deliveries
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
              </div>

              {/* Priority Settings (only when 'both' is selected) */}
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
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, own_rider_priority: checked })
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formData.own_rider_priority
                      ? '✓ Your riders will be assigned first. If none are available, platform riders will be used.'
                      : '✓ Platform riders will be assigned first. Your riders will be used as backup.'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Marketing Materials */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Megaphone className="w-5 h-5" />
                Marketing Materials
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate printable marketing banners with QR codes for in-store customer discovery.
              </p>
              {vendor && (
                <MarketingBanner
                  vendor={{
                    id: vendor.id,
                    name: vendor.name,
                    address: vendor.address,
                    city: vendor.city,
                    state: vendor.state,
                    logo_url: vendor.logo_url,
                  }}
                />
              )}
            </CardContent>
          </Card>

          {/* Favorites QR Code */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Heart className="w-5 h-5 text-destructive" />
                Customer Favorites QR Code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Display this QR code in your store. When customers scan it, they can instantly add your store to their favorites for quick access.
              </p>
              {vendor && (
                <div className="flex flex-col items-center gap-4 p-4 bg-muted/50 rounded-xl">
                  <div className="p-4 bg-background rounded-lg shadow-sm">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}/vendor/${vendor.id}?action=favorite`)}`}
                      alt="Favorites QR Code"
                      className="w-48 h-48"
                    />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-foreground">Scan to Favorite</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {window.location.origin}/vendor/{vendor.id}?action=favorite
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`${window.location.origin}/vendor/${vendor.id}?action=favorite`)}`;
                      link.download = `${vendor.name}-favorites-qr.png`;
                      link.click();
                    }}
                  >
                    <QrCode className="w-4 h-4" />
                    Download QR Code
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg">Account Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
                <div>
                  <p className="font-medium text-foreground">Store Visibility</p>
                  <p className="text-sm text-muted-foreground">
                    {vendor?.is_active
                      ? 'Your store is visible to customers'
                      : 'Your store is pending approval or hidden'}
                  </p>
                </div>
                <Switch checked={vendor?.is_active ?? false} disabled />
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

// Helper component to auto-save GPS coordinates when obtained
function GpsAutoSave({ 
  vendorId, 
  lat, 
  lon, 
  onComplete, 
  onError 
}: { 
  vendorId: string; 
  lat: number; 
  lon: number; 
  onComplete: () => void; 
  onError: (msg: string) => void;
}) {
  useEffect(() => {
    if (!vendorId || !lat || !lon) return;
    
    const saveLocation = async () => {
      try {
        const { error } = await supabase
          .from('vendors')
          .update({ latitude: lat, longitude: lon })
          .eq('id', vendorId);
        
        if (error) throw error;
        onComplete();
      } catch (err) {
        console.error('Failed to save GPS:', err);
        onError('Failed to save location');
      }
    };
    
    saveLocation();
  }, [vendorId, lat, lon, onComplete, onError]);

  return null;
}
