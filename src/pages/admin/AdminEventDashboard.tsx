import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ticket, DollarSign, Users, CheckCircle2, Gift, Download, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useEvent } from '@/hooks/useEvents';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

interface AttendeeRow {
  ticket_id: string;
  ticket_code: string;
  status: string;
  price: number;
  checked_in_at: string | null;
  created_at: string;
  ticket_type_name: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export default function AdminEventDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { event, ticketTypes, loading } = useEvent(id);
  const [tickets, setTickets] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setBusy(true);
      const [{ data: tk }, { data: ord }, { data: vc }] = await Promise.all([
        supabase.from('event_tickets').select('*, event_ticket_types(name)').eq('event_id', id),
        supabase.from('event_ticket_orders').select('*').eq('event_id', id),
        supabase.from('event_vouchers').select('id, status, sponsor, sponsor_cost, redeemed_at, vendor_id, vendors(name)').eq('event_id', id),
      ]);
      setTickets(tk || []);
      setOrders(ord || []);
      setVouchers(vc || []);

      const userIds = Array.from(new Set((tk || []).map((t: any) => t.user_id).filter(Boolean)));
      if (userIds.length) {
        const { data: pr } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone')
          .in('id', userIds);
        const map: Record<string, any> = {};
        (pr || []).forEach((p: any) => (map[p.id] = p));
        setProfiles(map);
      }
      setBusy(false);
    })();
  }, [id]);

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
    const reserved = vouchers.filter(v => v.status === 'reserved').length;
    const cost = vouchers
      .filter(v => v.status === 'redeemed')
      .reduce((s, v) => s + Number(v.sponsor_cost || 0), 0);
    return { total, redeemed, reserved, cost, rate: total ? Math.round((redeemed / total) * 100) : 0 };
  }, [vouchers]);

  // Sales over time (by day)
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

  // Ticket type breakdown
  const ticketBreakdown = useMemo(() => {
    return ticketTypes.map(tt => {
      const sold = activeTickets.filter(t => t.ticket_type_id === tt.id).length;
      const revenue = activeTickets
        .filter(t => t.ticket_type_id === tt.id)
        .reduce((s, t) => s + Number(t.price || 0), 0);
      return {
        name: tt.name,
        sold,
        remaining: tt.qty_available - tt.qty_sold,
        revenue,
        qty_available: tt.qty_available,
      };
    });
  }, [ticketTypes, activeTickets]);

  // Voucher redemption per vendor
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

  const attendeeRows: AttendeeRow[] = useMemo(() => {
    return activeTickets.map(t => {
      const p = profiles[t.user_id] || {};
      return {
        ticket_id: t.id,
        ticket_code: t.ticket_code,
        status: t.status,
        price: Number(t.price || 0),
        checked_in_at: t.checked_in_at,
        created_at: t.created_at,
        ticket_type_name: t.event_ticket_types?.name || '—',
        buyer_name: p.full_name || '—',
        buyer_email: p.email || '—',
        buyer_phone: p.phone || '—',
      };
    });
  }, [activeTickets, profiles]);

  const filteredAttendees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendeeRows;
    return attendeeRows.filter(a =>
      [a.ticket_code, a.buyer_name, a.buyer_email, a.buyer_phone, a.ticket_type_name]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [attendeeRows, search]);

  const exportCsv = () => {
    const header = ['Ticket Code', 'Type', 'Buyer', 'Email', 'Phone', 'Price', 'Status', 'Purchased', 'Checked In'];
    const rows = filteredAttendees.map(a => [
      a.ticket_code,
      a.ticket_type_name,
      a.buyer_name,
      a.buyer_email,
      a.buyer_phone,
      a.price,
      a.status,
      a.created_at,
      a.checked_in_at || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event?.slug || 'event'}-attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || busy) return <AdminLayout><p>Loading dashboard…</p></AdminLayout>;
  if (!event) return <AdminLayout><p>Event not found</p></AdminLayout>;

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <button onClick={() => navigate('/admin/events')} className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <p className="text-sm text-muted-foreground">
              {format(parseISO(event.event_date), 'EEE, MMM d, yyyy')}
              {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
              {event.location_text ? ` · ${event.location_text}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/admin/events/${id}`)}>Manage Tickets</Button>
            <Button variant="outline" onClick={() => navigate('/admin/event-verify')}>Check-in Scanner</Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard icon={<Ticket className="w-4 h-4" />} label="Tickets Sold" value={totals.sold.toLocaleString()} sub={event.capacity ? `${totals.capacityPct}% of ${event.capacity}` : ''} />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={`₦${totals.revenue.toLocaleString()}`} sub={`${paidOrders.length} orders`} />
          <KpiCard icon={<Users className="w-4 h-4" />} label="Unique Buyers" value={totals.uniqueBuyers.toLocaleString()} />
          <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Checked In" value={totals.checked.toLocaleString()} sub={`${totals.sold ? Math.round((totals.checked / totals.sold) * 100) : 0}% attendance`} />
          <KpiCard icon={<Gift className="w-4 h-4" />} label="Vouchers Redeemed" value={`${voucherStats.redeemed}/${voucherStats.total}`} sub={`${voucherStats.rate}% · ₦${voucherStats.cost.toLocaleString()} cost`} />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-3">Sales Over Time</h3>
            {salesByDay.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">No sales yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={salesByDay}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => format(parseISO(d), 'MMM d')} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any, n: string) => n === 'revenue' ? `₦${Number(v).toLocaleString()}` : v} labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-3">Tickets by Type</h3>
            {ticketBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">No ticket types</p>
            ) : (
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
          </div>
        </div>

        {/* Ticket type breakdown table */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3">Ticket Type Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-right py-2 px-2">Sold</th>
                  <th className="text-right py-2 px-2">Remaining</th>
                  <th className="text-right py-2 px-2">Capacity</th>
                  <th className="text-right py-2 px-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {ticketBreakdown.map((t, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 px-2 font-medium">{t.name}</td>
                    <td className="py-2 px-2 text-right">{t.sold}</td>
                    <td className="py-2 px-2 text-right">{t.remaining}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">{t.qty_available}</td>
                    <td className="py-2 px-2 text-right font-semibold">₦{t.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Voucher by vendor */}
        {voucherByVendor.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-3">Voucher Redemption by Vendor</h3>
            <div className="space-y-2">
              {voucherByVendor.map((v, i) => {
                const pct = v.total ? Math.round((v.redeemed / v.total) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{v.vendor}</span>
                      <span className="text-muted-foreground">{v.redeemed}/{v.total} · {pct}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Attendees */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="font-semibold text-sm">Attendees ({filteredAttendees.length})</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, code…" className="pl-8 h-9 w-56" />
              </div>
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={filteredAttendees.length === 0}>
                <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Buyer</th>
                  <th className="text-left py-2 px-2">Contact</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Code</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendees.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No attendees found</td></tr>
                )}
                {filteredAttendees.map(a => (
                  <tr key={a.ticket_id} className="border-b border-border/50">
                    <td className="py-2 px-2 font-medium">{a.buyer_name}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">
                      <div>{a.buyer_email}</div>
                      <div>{a.buyer_phone}</div>
                    </td>
                    <td className="py-2 px-2">{a.ticket_type_name}</td>
                    <td className="py-2 px-2 font-mono text-xs">{a.ticket_code}</td>
                    <td className="py-2 px-2 text-right">₦{a.price.toLocaleString()}</td>
                    <td className="py-2 px-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${
                        a.status === 'checked_in' ? 'bg-green-500/10 text-green-600' :
                        a.status === 'active' ? 'bg-primary/10 text-primary' :
                        'bg-muted text-muted-foreground'
                      }`}>{a.status.replace('_', ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}{label}
      </div>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
