import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoreTypeField, type StoreType, type SocialMediaHandles } from '@/components/vendor/StoreTypeField';
import { Store, Mail, Phone, Save, Camera, ImageIcon, Loader2, CheckCircle, Users, LogOut, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteAccountDialog } from '@/components/shared/DeleteAccountDialog';
import { VendorDocumentUpload } from '@/components/vendor/VendorDocumentUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { VendorWhatsAppAlerts } from '@/components/vendor/VendorWhatsAppAlerts';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE, PHONE_LENGTH } from '@/lib/phoneValidation';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

export default function VendorSettings() {
  const { user, loading: authLoading, signOut } = useAuth();
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
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    phone: '',
    email: '',
    logo_url: '',
    banner_url: '',
    store_type: 'physical' as StoreType,
    social_media_handles: {} as SocialMediaHandles,
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
      const { data: vendorResults } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      let vendorData = vendorResults?.[0] || null;

      if (!vendorData && user) {
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          const { data: staffVendor } = await supabase
            .from('vendors')
            .select('*')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      if (vendorData) {
        setFormData({
          name: vendorData.name,
          description: vendorData.description || '',
          phone: vendorData.phone || '',
          email: vendorData.email || '',
          logo_url: vendorData.logo_url || '',
          banner_url: vendorData.banner_url || '',
          store_type: ((vendorData as any).store_type || 'physical') as StoreType,
          social_media_handles: ((vendorData as any).social_media_handles || {}) as SocialMediaHandles,
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

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('vendor-assets')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image file', variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please upload an image smaller than 2MB', variant: 'destructive' });
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
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image file', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please upload an image smaller than 5MB', variant: 'destructive' });
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
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSave = async () => {
    if (!vendor) return;
    if (formData.phone && !isValidNgPhone(formData.phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        description: formData.description || null,
        phone: formData.phone || null,
        email: formData.email || null,
        logo_url: formData.logo_url || null,
        banner_url: formData.banner_url || null,
        store_type: formData.store_type,
        social_media_handles: formData.social_media_handles,
      };

      if (!vendor.is_verified) {
        updatePayload.name = formData.name;
      }

      const { error } = await supabase
        .from('vendors')
        .update(updatePayload)
        .eq('id', vendor.id);

      if (error) throw error;
      toast({ title: 'Settings saved successfully' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error saving settings', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || permLoading) {
    return (
      <VendorLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </VendorLayout>
    );
  }

  if (!hasPermission('edit_settings')) {
    return (
      <VendorLayout vendorName={vendor?.name} permissions={permissions}>
        <AccessDenied message="You don't have permission to edit settings." />
      </VendorLayout>
    );
  }

  return (
    <VendorLayout vendorName={vendor?.name} permissions={permissions}>
      <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Main Settings</h1>
              <p className="text-muted-foreground">Manage your brand profile & account</p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-2 w-fit">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Brand Assets */}
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
                    <Button variant="outline" size="sm" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                      {uploadingLogo ? 'Uploading...' : 'Choose Logo'}
                    </Button>
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
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
                <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
              </div>
            </CardContent>
          </Card>

          {/* Business Information */}
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
                    disabled={vendor?.is_verified === true}
                  />
                  {vendor?.is_verified && (
                    <p className="text-xs text-muted-foreground">
                      Store name is locked after approval. Contact admin to request a change.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: sanitizePhoneInput(e.target.value) })}
                    placeholder="08012345678"
                    maxLength={PHONE_LENGTH}
                    pattern="\d{11}"
                    title={PHONE_ERROR_MESSAGE}
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

          {/* Store Type & Social Media */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Store Type & Social Media
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StoreTypeField
                storeType={formData.store_type}
                onStoreTypeChange={(t) => setFormData({ ...formData, store_type: t })}
                socialHandles={formData.social_media_handles}
                onSocialHandlesChange={(h) => setFormData({ ...formData, social_media_handles: h })}
              />
            </CardContent>
          </Card>

          {/* Account Status */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg">Account Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
                <div>
                  <p className="font-medium text-foreground">Verification Status</p>
                  <p className="text-sm text-muted-foreground">
                    {vendor?.is_verified
                      ? 'Your business is verified'
                      : 'Your business is pending verification'}
                  </p>
                </div>
                {vendor?.is_verified ? (
                  <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                ) : (
                  <Switch checked={false} disabled />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Verification Documents */}
          {vendor && user && (
            <VendorDocumentUpload vendorId={vendor.id} userId={user.id} />
          )}

          {/* WhatsApp Order Alerts */}
          {vendor && (
            <VendorWhatsAppAlerts vendorId={vendor.id} vendorPhone={formData.phone} />
          )}

          {/* Staff Workspace Login */}
          {vendor?.slug && (
            <Card className="border-0 shadow-soft">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Staff Access
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Hand this device to a staff member. You will be logged out and redirected to the staff workspace login page.
                </p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <code className="text-xs text-primary break-all flex-1">
                    {window.location.origin}/workspace/{vendor.slug}
                  </code>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={async () => {
                    const slug = vendor.slug;
                    await signOut?.();
                    navigate(`/workspace/${slug}`);
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  Switch to Staff Login
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Delete Account */}
          {user && (
            <Card className="border-destructive/30">
              <CardContent className="p-6">
                <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Permanently delete your account and all business data.
                </p>
                <DeleteAccountDialog
                  userId={user.id}
                  userEmail={user.email || ''}
                  onDeleted={() => { signOut?.(); navigate('/'); }}
                />
              </CardContent>
            </Card>
          )}
      </div>
    </VendorLayout>
  );
}
