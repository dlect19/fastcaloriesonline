import { useState, useEffect } from 'react';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket, Trash2, ToggleLeft, ToggleRight, Users, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface VendorPromo {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  min_order_amount: number | null;
  max_discount: number | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  used_count: number | null;
  is_active: boolean | null;
  valid_from: string | null;
  valid_until: string | null;
}

export default function VendorPromos() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [promos, setPromos] = useState<VendorPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { selectedOutletId, setSelectedOutletId } = usePersistedOutletId();

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  const [formData, setFormData] = useState({
    code: '',
    description: '',
    discount_type: 'percentage',
    discount_value: '',
    min_order_amount: '',
    max_discount: '',
    usage_limit: '',
    per_user_limit: '',
    valid_until: '',
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user && selectedOutletId !== null) {
      fetchData();
    }
  }, [user, authLoading, navigate, selectedOutletId]);

  const fetchData = async () => {
    try {
      // Check if owner
      const { data: vendorResults } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      let vendorData = vendorResults?.[0] || null;

      // If not owner, check if staff
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
            .select('id, name')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      if (vendorData) {
        if (!selectedOutletId) {
          setPromos([]);
          return;
        }

        const { data: promosData } = await supabase
          .from('promo_codes')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .eq('outlet_id', selectedOutletId)
          .order('created_at', { ascending: false });

        setPromos(promosData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePromo = async () => {
    if (!selectedOutletId) {
      toast({
        title: 'Select an outlet first',
        description: 'Choose an outlet from the sidebar before creating promo codes.',
        variant: 'destructive',
      });
      return;
    }

    if (!vendor || !formData.code || !formData.discount_value) {
      toast({
        title: 'Missing required fields',
        description: 'Please fill in promo code and discount value',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('promo_codes').insert({
        code: formData.code.toUpperCase().trim(),
        description: formData.description || null,
        discount_type: formData.discount_type,
        discount_value: parseFloat(formData.discount_value),
        min_order_amount: formData.min_order_amount ? parseFloat(formData.min_order_amount) : null,
        max_discount: formData.max_discount ? parseFloat(formData.max_discount) : null,
        usage_limit: formData.usage_limit ? parseInt(formData.usage_limit) : null,
        per_user_limit: formData.per_user_limit ? parseInt(formData.per_user_limit) : null,
        valid_until: formData.valid_until || null,
        vendor_id: vendor.id,
        outlet_id: selectedOutletId,
        scope: 'vendor',
        is_active: true,
      });

      if (error) throw error;

      toast({ title: 'Promo code created successfully!' });
      setDialogOpen(false);
      setFormData({
        code: '',
        description: '',
        discount_type: 'percentage',
        discount_value: '',
        min_order_amount: '',
        max_discount: '',
        usage_limit: '',
        per_user_limit: '',
        valid_until: '',
      });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error creating promo',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const togglePromoStatus = async (promoId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('promo_codes')
        .update({ is_active: !currentStatus })
        .eq('id', promoId);

      if (error) throw error;

      toast({ title: `Promo ${!currentStatus ? 'activated' : 'deactivated'}` });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error updating promo',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const deletePromo = async (promoId: string) => {
    if (!confirm('Are you sure you want to delete this promo code?')) return;

    try {
      const { error } = await supabase
        .from('promo_codes')
        .delete()
        .eq('id', promoId);

      if (error) throw error;

      toast({ title: 'Promo code deleted' });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error deleting promo',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (authLoading || loading || permLoading) {
    return (
      <VendorLayout onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </VendorLayout>
    );
  }

  if (!hasPermission('manage_promos')) {
    return (
      <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <AccessDenied message="You don't have permission to manage promo codes." />
      </VendorLayout>
    );
  }

  return (
    <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Promo Codes</h1>
              <p className="text-muted-foreground">Create discounts for your customers</p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 w-fit">
                  <Plus className="w-4 h-4" />
                  Create Promo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Promo Code</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Code *</Label>
                    <Input
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      placeholder="SUMMER20"
                      className="uppercase"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="20% off summer special"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Discount Type</Label>
                      <Select
                        value={formData.discount_type}
                        onValueChange={(val) => setFormData({ ...formData, discount_type: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage (%)</SelectItem>
                          <SelectItem value="fixed">Fixed (₦)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Value *</Label>
                      <Input
                        type="number"
                        value={formData.discount_value}
                        onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                        placeholder={formData.discount_type === 'percentage' ? '20' : '500'}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Min Order (₦)</Label>
                      <Input
                        type="number"
                        value={formData.min_order_amount}
                        onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value })}
                        placeholder="1000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Discount (₦)</Label>
                      <Input
                        type="number"
                        value={formData.max_discount}
                        onChange={(e) => setFormData({ ...formData, max_discount: e.target.value })}
                        placeholder="2000"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Total Usage Limit</Label>
                      <Input
                        type="number"
                        value={formData.usage_limit}
                        onChange={(e) => setFormData({ ...formData, usage_limit: e.target.value })}
                        placeholder="100"
                      />
                      <p className="text-xs text-muted-foreground">Leave empty for unlimited</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Per Customer Limit</Label>
                      <Input
                        type="number"
                        value={formData.per_user_limit}
                        onChange={(e) => setFormData({ ...formData, per_user_limit: e.target.value })}
                        placeholder="1"
                      />
                      <p className="text-xs text-muted-foreground">Times each customer can use</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Expires On</Label>
                    <Input
                      type="datetime-local"
                      value={formData.valid_until}
                      onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                    />
                  </div>

                  <Button
                    onClick={handleCreatePromo}
                    disabled={saving}
                    className="w-full"
                  >
                    {saving ? 'Creating...' : 'Create Promo Code'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Promos List */}
          {promos.length === 0 ? (
            <Card className="border-0 shadow-soft">
              <CardContent className="py-12 text-center">
                <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold text-lg mb-2">No promo codes yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first promo code to attract customers
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {promos.map((promo) => (
                <Card key={promo.id} className="border-0 shadow-soft">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Ticket className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-bold text-lg">{promo.code}</span>
                            <Badge variant={promo.is_active ? 'default' : 'secondary'}>
                              {promo.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {promo.description || 'No description'}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">
                              {promo.discount_type === 'percentage'
                                ? `${promo.discount_value}% off`
                                : `₦${promo.discount_value} off`}
                            </Badge>
                            {promo.min_order_amount && (
                              <Badge variant="outline">Min: ₦{promo.min_order_amount}</Badge>
                            )}
                            {promo.per_user_limit && (
                              <Badge variant="outline" className="gap-1">
                                <Users className="w-3 h-3" />
                                {promo.per_user_limit}x per user
                              </Badge>
                            )}
                            {promo.valid_until && (
                              <Badge variant="outline" className="gap-1">
                                <Calendar className="w-3 h-3" />
                                Expires: {new Date(promo.valid_until).toLocaleDateString()}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Used: {promo.used_count || 0}{promo.usage_limit ? ` / ${promo.usage_limit}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => togglePromoStatus(promo.id, !!promo.is_active)}
                        >
                          {promo.is_active ? (
                            <ToggleRight className="w-5 h-5 text-primary" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deletePromo(promo.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
        </div>
    </VendorLayout>
  );
}
