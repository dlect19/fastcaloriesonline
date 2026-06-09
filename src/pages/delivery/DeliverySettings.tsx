import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Building2, Phone, Mail, MapPin, Loader2, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { DeleteAccountDialog } from '@/components/shared/DeleteAccountDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE, PHONE_LENGTH } from '@/lib/phoneValidation';

export default function DeliverySettings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { company, loading: companyLoading, isOwner, refetch } = useDeliveryCompany();
  
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      setFormData({
        name: company.name || '',
        phone: company.phone || '',
        email: company.email || '',
        address: company.address || '',
        city: company.city || '',
        state: company.state || '',
      });
    }
  }, [user, authLoading, company, navigate]);

  const handleSave = async () => {
    if (!company) return;
    if (!isValidNgPhone(formData.phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('delivery_companies')
        .update({
          name: formData.name,
          phone: formData.phone,
          email: formData.email,
          address: formData.address,
          city: formData.city,
          state: formData.state,
        })
        .eq('id', company.id);

      if (error) throw error;

      toast({ title: 'Settings saved successfully' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || companyLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DeliverySidebar companyName={company?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Company Settings</h1>
            <p className="text-muted-foreground">Manage your delivery company profile</p>
          </div>

          {/* Verification Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Verification Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {company?.is_verified ? (
                <div className="flex items-center gap-3 p-4 bg-success/10 rounded-lg">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                  <div>
                    <p className="font-medium text-success">Verified Company</p>
                    <p className="text-sm text-muted-foreground">
                      Your company is verified and can receive delivery assignments.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-warning/10 rounded-lg">
                  <AlertTriangle className="w-8 h-8 text-warning" />
                  <div>
                    <p className="font-medium text-warning">Pending Verification</p>
                    <p className="text-sm text-muted-foreground">
                      Your company is being reviewed. You'll be notified once verified.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Company Information
              </CardTitle>
              <CardDescription>
                {isOwner ? 'Update your company details' : 'View company details'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Company Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={!isOwner}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!isOwner}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Phone
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: sanitizePhoneInput(e.target.value) })}
                    disabled={!isOwner}
                    maxLength={PHONE_LENGTH}
                    pattern="\d{11}"
                    placeholder="08012345678"
                    title={PHONE_ERROR_MESSAGE}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Address
                </Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  disabled={!isOwner}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    disabled={!isOwner}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    disabled={!isOwner}
                  />
                </div>
              </div>

              {isOwner && (
                <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Commission Info */}
          <Card>
            <CardHeader>
              <CardTitle>Platform Commission</CardTitle>
              <CardDescription>Your current commission rate set by Fast Calories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold text-primary">{company?.commission_rate || 20}%</div>
                <div className="text-muted-foreground">
                  <p>Platform takes {company?.commission_rate || 20}% of each delivery fee.</p>
                  <p>You receive {100 - (company?.commission_rate || 20)}% of the delivery fee.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Delete Account */}
          {user && isOwner && (
            <Card className="border-destructive/30">
              <CardContent className="p-6">
                <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Permanently delete your logistics company account.
                </p>
                <DeleteAccountDialog
                  userId={user.id}
                  userEmail={user.email || ''}
                  onDeleted={() => navigate('/delivery/auth')}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
