import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function AdminPromos() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [promos, setPromos] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [scope, setScope] = useState('platform');
  const [perUserLimit, setPerUserLimit] = useState('');
  const [perUserResetPeriod, setPerUserResetPeriod] = useState('never');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
      return;
    }

    await fetchPromos();
  };

  const fetchPromos = async () => {
    try {
      const { data } = await supabase
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false });

      setPromos(data || []);
    } catch (error) {
      console.error('Error fetching promos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePromo = async () => {
    if (!code || !discountValue) {
      toast({ title: 'Please fill required fields', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await supabase.from('promo_codes').insert({
        code: code.toUpperCase(),
        discount_type: discountType,
        discount_value: parseFloat(discountValue),
        min_order_amount: minOrderAmount ? parseFloat(minOrderAmount) : 0,
        max_discount: maxDiscount ? parseFloat(maxDiscount) : null,
        usage_limit: usageLimit ? parseInt(usageLimit) : null,
        valid_until: validUntil || null,
        is_active: true,
        scope: scope,
        per_user_limit: perUserLimit ? parseInt(perUserLimit) : null,
        per_user_reset_period: perUserResetPeriod,
      });

      toast({ title: 'Promo code created successfully' });
      setDialogOpen(false);
      resetForm();
      fetchPromos();
    } catch (error: any) {
      toast({ title: error.message || 'Failed to create promo', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const togglePromo = async (promoId: string, isActive: boolean) => {
    try {
      await supabase.from('promo_codes').update({ is_active: !isActive }).eq('id', promoId);
      toast({ title: `Promo ${isActive ? 'deactivated' : 'activated'}` });
      fetchPromos();
    } catch (error) {
      toast({ title: 'Failed to update promo', variant: 'destructive' });
    }
  };

  const deletePromo = async (promoId: string) => {
    try {
      await supabase.from('promo_codes').delete().eq('id', promoId);
      toast({ title: 'Promo deleted' });
      fetchPromos();
    } catch (error) {
      toast({ title: 'Failed to delete promo', variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setCode('');
    setDiscountType('percentage');
    setDiscountValue('');
    setMinOrderAmount('');
    setMaxDiscount('');
    setUsageLimit('');
    setValidUntil('');
    setScope('platform');
    setPerUserLimit('');
    setPerUserResetPeriod('never');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Promo Codes</h1>
            <p className="text-muted-foreground">Create and manage discount codes</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Promo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Promo Code</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g., SAVE20"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount Type *</Label>
                    <Select value={discountType} onValueChange={setDiscountType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Discount Value *</Label>
                    <Input
                      type="number"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      placeholder={discountType === 'percentage' ? '20' : '500'}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Min Order Amount</Label>
                    <Input
                      type="number"
                      value={minOrderAmount}
                      onChange={(e) => setMinOrderAmount(e.target.value)}
                      placeholder="1000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Discount</Label>
                    <Input
                      type="number"
                      value={maxDiscount}
                      onChange={(e) => setMaxDiscount(e.target.value)}
                      placeholder="2000"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Scope</Label>
                    <Select value={scope} onValueChange={setScope}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="platform">Platform-wide</SelectItem>
                        <SelectItem value="vendor">Vendor-specific</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Per User Limit</Label>
                    <Input
                      type="number"
                      value={perUserLimit}
                      onChange={(e) => setPerUserLimit(e.target.value)}
                      placeholder="e.g. 1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Total Usage Limit</Label>
                    <Input
                      type="number"
                      value={usageLimit}
                      onChange={(e) => setUsageLimit(e.target.value)}
                      placeholder="100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Valid Until</Label>
                    <Input
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={handleCreatePromo} className="w-full" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Promo Code
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Promo Codes</CardTitle>
          </CardHeader>
          <CardContent>
            {promos.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No promo codes yet</p>
            ) : (
              <div className="space-y-4">
                {promos.map((promo) => (
                  <div key={promo.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-mono font-bold text-lg">{promo.code}</h3>
                        <Badge variant={promo.is_active ? 'default' : 'secondary'}>
                          {promo.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant="outline">
                          {promo.scope === 'vendor' ? 'Vendor' : 'Platform'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {promo.discount_type === 'percentage'
                          ? `${promo.discount_value}% off`
                          : `₦${promo.discount_value} off`}
                        {promo.min_order_amount > 0 && ` • Min ₦${promo.min_order_amount}`}
                        {promo.max_discount && ` • Max ₦${promo.max_discount}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Used {promo.used_count || 0}{promo.usage_limit ? `/${promo.usage_limit}` : ''} times
                        {promo.per_user_limit && ` • ${promo.per_user_limit}/user`}
                        {promo.valid_until && ` • Expires ${format(new Date(promo.valid_until), 'PP')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => togglePromo(promo.id, promo.is_active)}
                      >
                        {promo.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => deletePromo(promo.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
    </AdminLayout>
  );
}
