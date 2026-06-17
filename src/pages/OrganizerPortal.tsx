import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Ticket, DollarSign, Users, CheckCircle2, Gift, Download, Search, QrCode, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell,
} from 'recharts';
import OrganizerWalletSection from '@/components/organizer/OrganizerWalletSection';

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export default function OrganizerPortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    const { data: res, error } = await supabase.functions.invoke('organizer-event-data', { body: { token } });
    if (error || res?.error) {
      setErr(res?.error || error?.message || 'Failed to load');
    } else {
      setData(res);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [token]);

  const event = data?.event;
  const tickets: any[] = data?.tickets || [];
  const orders: any[] = data?.orders || [];
  const vouchers: any[] = data?.vouchers || [];
  const ticketTypes: any[] = data?.ticket_types || [];
  const profiles: Record<string, any> = data?.profiles || {};

  const activeTickets = useMemo(() => tickets.filter(t => t.status !== 'cancelled'), [tickets]);
  const paidOrders = useMemo(() => orders.filter(o => o.payment_status === 'paid'), [orders]);

  const totals = useMemo(() => {
    const sold = activeTickets.length;
    const revenue = activeTickets.reduce((s, t) => s + Number(t.price || 0), 0);
    const checked = activeTickets.filter(t => t.status === 'checked_in').length;
    const uniqueBuyers = new Set(activeTickets.map(t => t.user_id)).size;
    const capacityPct = event?.capacity ? Math.round((sold / event.capacity) * 100) : 0;
    return { sold, revenue, checked, uniqueBuyers, capacityPct };
  }, [activeTickets, event]);

  const voucherStats = useMemo(() => {
    const total = vouchers.length;
    const redeemed = vouchers.filter(v => v.status === 'redeemed').length;
    const cost = vouchers.filter(v => v.status === 'redeemed').reduce((s, v) => s + Number(v.sponsor_cost || 0), 0);
    return { total, redeemed, cost, rate: total ? Math.round((redeemed / total) * 100) : 0 };
  }, [vouchers]);

  const salesByDay = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; tickets: number }>();
    activeTickets.forEach(t => {
      const day = (t.created_at || '').slice(0, 10);
      if (!day) return;
      const cur = map.get(day) || { date: day, revenue: 0, tickets: 0 };
      cur.revenue += Number(t.price || 0);
      cur.tickets += 1;
      map.set(day, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [activeTickets]);

  const ticketBreakdown = useMemo(() => ticketTypes.map(tt => {
    const sold = activeTickets.filter(t => t.ticket_type_id === tt.id).length;
    const revenue = activeTickets.filter(t => t.ticket_type_id === tt.id).reduce((s, t) => s + Number(t.price || 0), 0);
    return { name: tt.name, sold, remaining: tt.qty_available - tt.qty_sold, qty_available: tt.qty_available, revenue };
  }), [ticketTypes, activeTickets]);

  const voucherByVendor = useMemo(() => {
    const map = new Map<string, { vendor: string; redeemed: number; total: number }>();
    vouchers.forEach(v => {
      const name = v.vendors?.name || 'Unknown';
      const cur = map.get(name) || { vendor: name, redeemed: 0, total: 0 };
      cur.total += 1;
      if (v.status === 'redeemed') cur.redeemed += 1;
      map.set(name, cur);
    });
    return Array.from(map.values());
  }, [vouchers]);

  const attendees = useMemo(() => activeTickets.map(t => {
    const p = profiles[t.user_id] || {};
    return {
      id: t.id,
      code: t.ticket_code,
      type: t.event_ticket_types?.name || '—',
      name: p.full_name || '—',
      email: p.email || '—',
      phone: p.phone || '—',
      price: Number(t.price || 0),
      status: t.status,
      created_at: t.created_at,
      checked_in_at: t.checked_in_at,
    };
  }), [activeTickets, profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendees;
    return attendees.filter(a => [a.code, a.name, a.email, a.phone, a.type].some(v => (v || '').toLowerCase().includes(q)));
  }, [attendees, search]);

  const exportCsv = () => {
    const rows = [['Ticket Code', 'Type', 'Buyer', 'Email', 'Phone', 'Price', 'Status', 'Purchased', 'Checked In']];
    filtered.forEach(a => rows.push([a.code, a.type, a.name, a.email, a.phone, String(a.price), a.status, a.created_at, a.checked_in_at || '']));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event?.slug || 'event'}-attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading organizer portal…</div>;
  if (err || !event) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold mb-2">Link not valid</h1>
        <p className="text-sm text-muted-foreground">{err || 'This organizer link is invalid or has been revoked. Contact the admin for a new link.'}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Organizer Portal</p>
            <h1 className="text-lg font-bold leading-tight">{event.name}</h1>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(event.event_date), 'EEE, MMM d, yyyy')}
              {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="default">
              <Link to={`/organizer/${token}/verify`}><QrCode className="w-3.5 h-3.5 mr-1.5" /> Verify Tickets</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh</Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={<Ticket className="w-4 h-4" />} label="Sold" value={totals.sold.toLocaleString()} sub={event.capacity ? `${totals.capacityPct}% of ${event.capacity}` : ''} />
          <Kpi icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={`₦${totals.revenue.toLocaleString()}`} sub={`${paidOrders.length} orders`} />
          <Kpi icon={<Users className="w-4 h-4" />} label="Unique Buyers" value={totals.uniqueBuyers.toLocaleString()} />
          <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="Checked In" value={totals.checked.toLocaleString()} sub={`${totals.sold ? Math.round((totals.checked / totals.sold) * 100) : 0}%`} />
          <Kpi icon={<Gift className="w-4 h-4" />} label="Vouchers" value={`${voucherStats.redeemed}/${voucherStats.total}`} sub={`${voucherStats.rate}% redeemed`} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Sales Over Time">
            {salesByDay.length === 0 ? <Empty>No sales yet</Empty> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={salesByDay}>
                  <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => format(parseISO(d), 'MMM d')} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any, n: string) => n === 'revenue' ? `₦${Number(v).toLocaleString()}` : v} labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>
          <Card title="Tickets by Type">
            {ticketBreakdown.length === 0 ? <Empty>No ticket types</Empty> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="sold" radius={[6, 6, 0, 0]}>
                    {ticketBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <Card title="Ticket Type Performance">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-right py-2 px-2">Sold</th>
                <th className="text-right py-2 px-2">Remaining</th>
                <th className="text-right py-2 px-2">Capacity</th>
                <th className="text-right py-2 px-2">Revenue</th>
              </tr></thead>
              <tbody>{ticketBreakdown.map((t, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 px-2 font-medium">{t.name}</td>
                  <td className="py-2 px-2 text-right">{t.sold}</td>
                  <td className="py-2 px-2 text-right">{t.remaining}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{t.qty_available}</td>
                  <td className="py-2 px-2 text-right font-semibold">₦{t.revenue.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>

        {voucherByVendor.length > 0 && (
          <Card title="Voucher Redemption by Vendor">
            <div className="space-y-2">{voucherByVendor.map((v, i) => {
              const pct = v.total ? Math.round((v.redeemed / v.total) * 100) : 0;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{v.vendor}</span>
                    <span className="text-muted-foreground">{v.redeemed}/{v.total} · {pct}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}</div>
          </Card>
        )}

        <Card title={`Attendees (${filtered.length})`} right={
          <div className="flex gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="pl-8 h-9 w-48" />
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}><Download className="w-3.5 h-3.5 mr-1.5" /> CSV</Button>
          </div>
        }>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr>
                <th className="text-left py-2 px-2">Buyer</th>
                <th className="text-left py-2 px-2">Contact</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-left py-2 px-2">Code</th>
                <th className="text-left py-2 px-2">Status</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No attendees</td></tr>}
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="py-2 px-2 font-medium">{a.name}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground"><div>{a.email}</div><div>{a.phone}</div></td>
                    <td className="py-2 px-2">{a.type}</td>
                    <td className="py-2 px-2 font-mono text-xs">{a.code}</td>
                    <td className="py-2 px-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${
                      a.status === 'checked_in' ? 'bg-green-500/10 text-green-600' :
                      a.status === 'active' ? 'bg-primary/10 text-primary' :
                      'bg-muted text-muted-foreground'
                    }`}>{a.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
function Card({ title, right, children }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: any) {
  return <p className="text-sm text-muted-foreground py-10 text-center">{children}</p>;
}
