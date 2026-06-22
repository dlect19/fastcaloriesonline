import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Gift, CheckCircle2, XCircle, Search, Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

type ShadowRow = {
  id: string;
  phone: string;
  customer_name: string | null;
  customer_email: string | null;
  amount: number;
  environment: string;
  status: 'pending' | 'claimed' | 'cancelled' | 'settled_offline';
  source: string;
  order_id: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string;
  claimed_at: string | null;
  claimed_user_id: string | null;
};

export default function AdminShadowCredits() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ShadowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'claimed' | 'cancelled' | 'settled_offline' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('shadow_customer_credits').select('*').order('created_at', { ascending: false }).limit(300);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data } = await q;
    setRows((data as ShadowRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const filtered = rows.filter(r => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return r.phone.includes(s) || (r.customer_name || '').toLowerCase().includes(s) || (r.customer_email || '').toLowerCase().includes(s);
  });

  const totals = {
    pending: rows.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0),
    claimed: rows.filter(r => r.status === 'claimed').reduce((s, r) => s + Number(r.amount), 0),
  };

  const settle = async (id: string, status: 'settled_offline' | 'cancelled') => {
    setBusy(id);
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === 'cancelled') {
      update.cancelled_at = new Date().toISOString();
      const { data: u } = await supabase.auth.getUser();
      update.cancelled_by = u.user?.id;
    }
    const { error } = await supabase.from('shadow_customer_credits').update(update).eq('id', id);
    setBusy(null);
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Updated' }); await load(); }
  };

  const statusBadge = (s: ShadowRow['status']) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
      claimed: 'bg-green-500/10 text-green-700 border-green-500/30',
      cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
      settled_offline: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
    };
    return <Badge variant="outline" className={map[s] || ''}>{s.replace('_', ' ')}</Badge>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center gap-2">
          <Gift className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Shadow Customer Credits</h1>
            <p className="text-muted-foreground text-sm">Refund credits held by phone for customers without an account. Auto-claimed when they sign up with the same phone.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pending</div><div className="text-2xl font-bold">₦{totals.pending.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Claimed</div><div className="text-2xl font-bold">₦{totals.claimed.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Records</div><div className="text-2xl font-bold">{rows.length}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <CardTitle>Records</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input className="pl-8 w-56" placeholder="Search phone, name, email" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {(['pending', 'claimed', 'settled_offline', 'cancelled', 'all'] as const).map(f => (
                <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No records.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left bg-muted/40">
                    <tr>
                      <th className="p-2">Phone</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Reason</th>
                      <th className="p-2">Created</th>
                      <th className="p-2">Claimed</th>
                      <th className="p-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-mono">{r.phone}</td>
                        <td className="p-2">{r.customer_name || '—'}</td>
                        <td className="p-2 font-semibold">₦{Number(r.amount).toLocaleString()}</td>
                        <td className="p-2">{statusBadge(r.status)}</td>
                        <td className="p-2 text-muted-foreground">{r.reason || '—'}</td>
                        <td className="p-2 text-muted-foreground">{format(new Date(r.created_at), 'PP')}</td>
                        <td className="p-2 text-muted-foreground">{r.claimed_at ? format(new Date(r.claimed_at), 'PP') : '—'}</td>
                        <td className="p-2 text-right">
                          {r.status === 'pending' && (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="outline" disabled={busy === r.id}
                                onClick={() => { if (confirm(`Mark as paid offline (cash/bank) for ${r.phone}?`)) settle(r.id, 'settled_offline'); }}>
                                <Banknote className="w-3 h-3 mr-1" /> Settled offline
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy === r.id}
                                onClick={() => { if (confirm(`Cancel this ₦${Number(r.amount).toLocaleString()} credit for ${r.phone}?`)) settle(r.id, 'cancelled'); }}>
                                <XCircle className="w-3 h-3 mr-1" /> Cancel
                              </Button>
                            </div>
                          )}
                          {r.status === 'claimed' && <CheckCircle2 className="w-4 h-4 text-green-600 ml-auto" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
