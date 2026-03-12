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
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Loader2, Percent, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Vendor {
  id: string;
  name: string;
  commission_rate: number;
}

interface CommissionPromo {
  id: string;
  vendor_id: string;
  promo_commission_rate: number;
  normal_commission_rate: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  vendors?: { name: string; commission_rate: number };
}

export default function AdminVendorCommissionPromos() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [promos, setPromos] = useState<CommissionPromo[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [vendorId, setVendorId] = useState('');
  const [promoRate, setPromoRate] = useState('');
  const [normalRate, setNormalRate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }
    await Promise.all([fetchPromos(), fetchVendors()]);
  };

  const fetchPromos = async () => {
    try {
      const { data } = await supabase
        .from('vendor_commission_promos')
        .select('*, vendors(name, commission_rate)')
        .order('created_at', { ascending: false });
      setPromos((data as any) || []);
    } catch (error) {
      console.error('Error fetching commission promos:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    const { data } = await supabase
      .from('vendors')
      .select('id, name, commission_rate')
      .eq('is_verified', true)
      .order('name');
    setVendors(data || []);
  };

  const handleVendorSelect = (id: string) => {
    setVendorId(id);
    const vendor = vendors.find(v => v.id === id);
    if (vendor) {
      setNormalRate(String(vendor.commission_rate));
    }
  };

  const handleCreate = async () => {
    if (!vendorId || !promoRate || !normalRate || !startDate || !endDate) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      toast({ title: 'End date must be after start date', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from('vendor_commission_promos').insert({
        vendor_id: vendorId,
        promo_commission_rate: parseFloat(promoRate),
        normal_commission_rate: parseFloat(normalRate),
        start_date: startDate,
        end_date: endDate,
        notes: notes || null,
        created_by: user?.id,
        is_active: true,
      });

      if (error) throw error;

      // If promo starts today or earlier, apply immediately
      if (new Date(startDate) <= new Date()) {
        await supabase
          .from('vendors')
          .update({ commission_rate: parseFloat(promoRate) })
          .eq('id', vendorId);
      }

      toast({ title: 'Commission promo created successfully' });
      setDialogOpen(false);
      resetForm();
      fetchPromos();
    } catch (error: any) {
      toast({ title: error.message || 'Failed to create promo', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const togglePromo = async (promo: CommissionPromo) => {
    try {
      await supabase
        .from('vendor_commission_promos')
        .update({ is_active: !promo.is_active, updated_at: new Date().toISOString() })
        .eq('id', promo.id);

      // If deactivating, revert vendor commission to normal rate
      if (promo.is_active) {
        await supabase
          .from('vendors')
          .update({ commission_rate: promo.normal_commission_rate })
          .eq('id', promo.vendor_id);
      }

      toast({ title: `Promo ${promo.is_active ? 'deactivated' : 'activated'}` });
      fetchPromos();
    } catch {
      toast({ title: 'Failed to update', variant: 'destructive' });
    }
  };

  const deletePromo = async (promo: CommissionPromo) => {
    try {
      // Revert commission if active
      if (promo.is_active) {
        await supabase
          .from('vendors')
          .update({ commission_rate: promo.normal_commission_rate })
          .eq('id', promo.vendor_id);
      }
      await supabase.from('vendor_commission_promos').delete().eq('id', promo.id);
      toast({ title: 'Commission promo deleted' });
      fetchPromos();
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setVendorId('');
    setPromoRate('');
    setNormalRate('');
    setStartDate('');
    setEndDate('');
    setNotes('');
  };

  const getDaysRemaining = (endDate: string) => {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
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
            <h1 className="text-3xl font-bold text-foreground">Vendor Commission Promos</h1>
            <p className="text-muted-foreground">Set temporary commission rates for vendors</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />New Commission Promo</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Commission Promo</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Vendor *</Label>
                  <Select value={vendorId} onValueChange={handleVendorSelect}>
                    <SelectTrigger><SelectValue placeholder="Select a vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name} (current: {v.commission_rate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Promo Commission Rate (%) *</Label>
                    <Input
                      type="number"
                      value={promoRate}
                      onChange={(e) => setPromoRate(e.target.value)}
                      placeholder="e.g. 5"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Normal Rate After Promo (%) *</Label>
                    <Input
                      type="number"
                      value={normalRate}
                      onChange={(e) => setNormalRate(e.target.value)}
                      placeholder="e.g. 15"
                      min="0"
                      max="100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date *</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. New vendor onboarding discount"
                  />
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Create Commission Promo
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Commission Promos</CardTitle>
          </CardHeader>
          <CardContent>
            {promos.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No commission promos yet</p>
            ) : (
              <div className="space-y-4">
                {promos.map((promo) => {
                  const daysLeft = getDaysRemaining(promo.end_date);
                  const isExpired = daysLeft <= 0;
                  return (
                    <div key={promo.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-lg">{promo.vendors?.name || 'Unknown Vendor'}</h3>
                          <Badge variant={promo.is_active && !isExpired ? 'default' : 'secondary'}>
                            {isExpired ? 'Expired' : promo.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Percent className="w-3.5 h-3.5" />
                            {promo.promo_commission_rate}% → {promo.normal_commission_rate}%
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {format(new Date(promo.start_date), 'PP')} – {format(new Date(promo.end_date), 'PP')}
                          </span>
                        </div>
                        {!isExpired && promo.is_active && (
                          <p className="text-xs text-primary font-medium">{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
                        )}
                        {promo.notes && (
                          <p className="text-xs text-muted-foreground">{promo.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => togglePromo(promo)}>
                          {promo.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deletePromo(promo)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
    </AdminLayout>
  );
}
