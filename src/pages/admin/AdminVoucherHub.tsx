import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Ticket, Wallet, TrendingUp } from 'lucide-react';

export default function AdminVoucherHub() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [defaultPct, setDefaultPct] = useState<string>('10');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [vendorMap, setVendorMap] = useState<Record<string, string>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [savingDefault, setSavingDefault] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [ordersRes, settingRes, overridesRes, vendorsRes, catsRes] = await Promise.all([
      supabase.from('voucher_orders').select('*').eq('status', 'paid').order('purchased_at', { ascending: false }),
      supabase.from('platform_settings').select('value').eq('key', 'voucher_hub_default_commission_pct').maybeSingle(),
      supabase.from('vendor_commission_rates').select('*'),
      supabase.from('vendors').select('id, name'),
      supabase.from('voucher_categories').select('id, name'),
    ]);
    setOrders(ordersRes.data || []);
    setDefaultPct(settingRes.data?.value || '10');
    const ov: Record<string, string> = {};
    (overridesRes.data || []).forEach((r: any) => { if (r.percentage != null) ov[r.vendor_id] = String(r.percentage); });
    setOverrides(ov);
    const vm: Record<string, string> = {};
    (vendorsRes.data || []).forEach((v: any) => { vm[v.id] = v.name; });
    setVendorMap(vm);
    setVendors(vendorsRes.data || []);
    const cm: Record<string, string> = {};
    (catsRes.data || []).forEach((c: any) => { cm[c.id] = c.name; });
    setCategoryMap(cm);
  };

  const totalRevenue = orders.reduce((s, o) => s + Number(o.amount), 0);
  const totalCommission = orders.reduce((s, o) => s + Number(o.commission_amount), 0);
  const thisMonth = orders.filter(o => new Date(o.purchased_at).getMonth() === new Date().getMonth() && new Date(o.purchased_at).getFullYear() === new Date().getFullYear());

  const byVendor: Record<string, { count: number; revenue: number; commission: number }> = {};
  const byCategory: Record<string, { count: number; revenue: number }> = {};
  orders.forEach(o => {
    const v = byVendor[o.vendor_id] ||= { count: 0, revenue: 0, commission: 0 };
    v.count++; v.revenue += Number(o.amount); v.commission += Number(o.commission_amount);
    const c = byCategory[o.category_id] ||= { count: 0, revenue: 0 };
    c.count++; c.revenue += Number(o.amount);
  });

  const saveDefault = async () => {
    setSavingDefault(true);
    await supabase.from('platform_settings').upsert({ key: 'voucher_hub_default_commission_pct', value: defaultPct }, { onConflict: 'key' });
    setSavingDefault(false);
    toast({ title: 'Default commission saved' });
  };

  const saveOverride = async (vendorId: string) => {
    const raw = overrides[vendorId];
    const pct = raw === '' || raw == null ? null : Number(raw);
    if (pct != null && (isNaN(pct) || pct < 0 || pct > 100)) return toast({ title: 'Enter 0-100', variant: 'destructive' });
    await supabase.from('vendor_commission_rates').upsert({ vendor_id: vendorId, percentage: pct }, { onConflict: 'vendor_id' });
    toast({ title: 'Override saved' });
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Ticket className="w-6 h-6" /> Voucher Hub</h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Vouchers sold</p><p className="text-xl font-bold">{orders.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-bold">₦{totalRevenue.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Commission earned</p><p className="text-xl font-bold">₦{totalCommission.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">This month</p><p className="text-xl font-bold">{thisMonth.length} sales</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Platform commission</CardTitle></CardHeader>
          <CardContent className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <Label>Default commission (%)</Label>
              <Input type="number" min={0} max={100} step="0.1" value={defaultPct} onChange={(e) => setDefaultPct(e.target.value)} />
            </div>
            <Button onClick={saveDefault} disabled={savingDefault}>{savingDefault ? 'Saving…' : 'Save default'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>By vendor</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Sold</TableHead><TableHead>Revenue</TableHead><TableHead>Commission</TableHead><TableHead>Override %</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {vendors.filter(v => byVendor[v.id] || overrides[v.id] != null).map(v => (
                  <TableRow key={v.id}>
                    <TableCell>{v.name}</TableCell>
                    <TableCell>{byVendor[v.id]?.count ?? 0}</TableCell>
                    <TableCell>₦{(byVendor[v.id]?.revenue || 0).toLocaleString()}</TableCell>
                    <TableCell>₦{(byVendor[v.id]?.commission || 0).toLocaleString()}</TableCell>
                    <TableCell><Input type="number" className="w-24" value={overrides[v.id] ?? ''} placeholder={defaultPct} onChange={(e) => setOverrides({ ...overrides, [v.id]: e.target.value })} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => saveOverride(v.id)}>Save</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>By category</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Sold</TableHead><TableHead>Revenue</TableHead></TableRow></TableHeader>
              <TableBody>
                {Object.entries(byCategory).map(([id, s]) => (
                  <TableRow key={id}>
                    <TableCell>{categoryMap[id] || id}</TableCell>
                    <TableCell>{s.count}</TableCell>
                    <TableCell>₦{s.revenue.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
