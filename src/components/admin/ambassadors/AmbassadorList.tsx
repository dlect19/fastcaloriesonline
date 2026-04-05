import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Download, Eye, Pencil } from 'lucide-react';
import { AmbassadorDetail } from './AmbassadorDetail';

const emptyForm = { name: '', email: '', phone: '', social_handle: '', promo_code: '', package_type: 'paid', discount_percentage: '10' };

export function AmbassadorList() {
  const { toast } = useToast();
  const [ambassadors, setAmbassadors] = useState<any[]>([]);
  const [performance, setPerformance] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchData = async () => {
    setLoading(true);
    const { data: amb } = await supabase.from('ambassadors').select('*').order('created_at', { ascending: false });
    setAmbassadors(amb || []);

    if (amb && amb.length > 0) {
      const { data: perf } = await supabase.from('ambassador_performance').select('*').in('ambassador_id', amb.map(a => a.id));
      const perfMap: Record<string, any> = {};
      (perf || []).forEach(p => { perfMap[p.ambassador_id] = p; });
      setPerformance(perfMap);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.promo_code) {
      toast({ title: 'Name and promo code are required', variant: 'destructive' });
      return;
    }
    const discount = parseFloat(form.discount_percentage) || 10;
    if (discount < 1 || discount > 100) {
      toast({ title: 'Discount must be between 1% and 100%', variant: 'destructive' });
      return;
    }
    const { data, error } = await supabase.from('ambassadors').insert({
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      social_handle: form.social_handle || null,
      promo_code: form.promo_code.toLowerCase(),
      package_type: form.package_type,
      discount_percentage: discount,
    }).select().single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    await supabase.from('ambassador_performance').insert({ ambassador_id: data.id });
    toast({ title: 'Ambassador created!' });
    setCreateOpen(false);
    setForm(emptyForm);
    fetchData();
  };

  const openEdit = (a: any) => {
    setEditingId(a.id);
    setForm({
      name: a.name || '',
      email: a.email || '',
      phone: a.phone || '',
      social_handle: a.social_handle || '',
      promo_code: a.promo_code || '',
      package_type: a.package_type || 'paid',
      discount_percentage: String(a.discount_percentage ?? 10),
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingId || !form.name || !form.promo_code) {
      toast({ title: 'Name and promo code are required', variant: 'destructive' });
      return;
    }
    const discount = parseFloat(form.discount_percentage) || 10;
    if (discount < 1 || discount > 100) {
      toast({ title: 'Discount must be between 1% and 100%', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('ambassadors').update({
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      social_handle: form.social_handle || null,
      promo_code: form.promo_code.toLowerCase(),
      package_type: form.package_type,
      discount_percentage: discount,
    }).eq('id', editingId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Ambassador updated!' });
    setEditOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    fetchData();
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    await supabase.from('ambassadors').update({ is_active: !currentActive }).eq('id', id);
    toast({ title: `Ambassador ${currentActive ? 'deactivated' : 'activated'}` });
    fetchData();
  };

  const exportCSV = () => {
    const rows = ambassadors.map(a => {
      const p = performance[a.id] || {};
      return `${a.name},${a.email || ''},${a.phone || ''},${a.social_handle || ''},${a.promo_code},${a.package_type},${a.discount_percentage ?? 10}%,${p.total_registrations || 0},${p.total_orders || 0},${p.total_revenue || 0}`;
    });
    const csv = `Name,Email,Phone,Social,Code,Package,Discount,Registrations,Orders,Revenue\n${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ambassadors.csv';
    link.click();
  };

  const filtered = ambassadors.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.promo_code.toLowerCase().includes(search.toLowerCase())
  );

  if (detailId) {
    return <AmbassadorDetail ambassadorId={detailId} onBack={() => { setDetailId(null); fetchData(); }} />;
  }

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-3">
      <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
      <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
      <div><Label>Social Handle</Label><Input value={form.social_handle} onChange={e => setForm(f => ({ ...f, social_handle: e.target.value }))} placeholder="@handle" /></div>
      <div><Label>Promo Code *</Label><Input value={form.promo_code} onChange={e => setForm(f => ({ ...f, promo_code: e.target.value }))} /></div>
      <div>
        <Label>Discount Percentage (%) *</Label>
        <Input type="number" min={1} max={100} value={form.discount_percentage} onChange={e => setForm(f => ({ ...f, discount_percentage: e.target.value }))} placeholder="e.g. 10" />
        <p className="text-xs text-muted-foreground mt-1">Discount customers receive when using this promo code</p>
      </div>
      <div>
        <Label>Package Type</Label>
        <Select value={form.package_type} onValueChange={v => setForm(f => ({ ...f, package_type: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="paid">Paid Promotion</SelectItem>
            <SelectItem value="equity">Equity Package</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" onClick={isEdit ? handleEdit : handleCreate}>
        {isEdit ? 'Update Ambassador' : 'Create Ambassador'}
      </Button>
    </div>
  );

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <CardTitle>All Ambassadors</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-48" />
            </div>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Ambassador</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add New Ambassador</DialogTitle></DialogHeader>
                {renderForm(false)}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No ambassadors found</p>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Registrations</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(a => {
                  const p = performance[a.id] || {};
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{a.promo_code}</code></TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.discount_percentage ?? 10}%</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.package_type === 'equity' ? 'default' : 'secondary'}>
                          {a.package_type === 'equity' ? 'Equity' : 'Paid'}
                        </Badge>
                      </TableCell>
                      <TableCell>Lvl {a.current_level}</TableCell>
                      <TableCell>{p.total_registrations || 0}</TableCell>
                      <TableCell>{p.total_orders || 0}</TableCell>
                      <TableCell>₦{(p.total_revenue || 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={a.is_active ? 'default' : 'destructive'} 
                          className="cursor-pointer"
                          onClick={() => toggleActive(a.id, a.is_active)}
                        >
                          {a.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDetailId(a.id)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) { setEditingId(null); setForm(emptyForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Ambassador</DialogTitle></DialogHeader>
          {renderForm(true)}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
