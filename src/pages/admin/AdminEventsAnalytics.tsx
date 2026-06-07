import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, DollarSign, Ticket, Gift, TrendingUp, Users } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts';

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function AdminEventsAnalytics() {
  const navigate = useNavigate();
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('30');
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = range === 'all' ? null : subDays(new Date(), Number(range)).toISOString();
      const tq = supabase.from('event_tickets').select('id, event_id, ticket_type_id, status, price, created_at, user_id, events(name, event_date)');
      const vq = supabase.from('event_vouchers').select('id, status, sponsor, sponsor_cost, vendor_id, vendors(name), created_at');
      if (since) { tq.gte('created_at', since); vq.gte('created_at', since); }
      const [{ data: ev }, { data: tk }, { data: vc }] = await Promise.all([
        supabase.from('events').select('id, name, event_date, status, capacity, organizer'),
        tq, vq,
      ]);
      setEvents(ev || []);
      setTickets(tk || []);
      setVouchers(vc || []);
      setLoading(false);
    })();
  }, [range]);

  const activeTickets = useMemo(() => tickets.filter(t => t.status !== 'cancelled'), [tickets]);

  const totals = useMemo(() => {
    const revenue = activeTickets.reduce((s, t) => s + Number(t.price || 0), 0);
    const sold = activeTickets.length;
    const checkedIn = activeTickets.filter(t => t.status === 'checked_in').length;
    const buyers = new Set(activeTickets.map(t => t.user_id)).size;
    const eventCount = events.length;
    const upcoming = events.filter(e => e.event_date >= new Date().toISOString().slice(0, 10) && e.status === 'published').length;
    return { revenue, sold, checkedIn, buyers, eventCount, upcoming };
  }, [activeTickets, events]);

  const voucherStats = useMemo(() => {
    const total = vouchers.length;
    const redeemed = vouchers.filter(v => v.status === 'redeemed').length;
    const cost = vouchers.filter(v => v.status === 'redeemed').reduce((s, v) => s + Number(v.sponsor_cost || 0), 0);
    return { total, redeemed, cost, rate: total ? Math.round((redeemed / total) * 100) : 0 };
  }, [vouchers]);

  // Revenue trend by day
  const revenueTrend = useMemo(() => {
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

  // Top events by revenue
  const topEvents = useMemo(() => {
    const map = new Map<string, { event_id: string; name: string; revenue: number; sold: number; date: string }>();
    activeTickets.forEach(t => {
      const cur = map.get(t.event_id) || {
        event_id: t.event_id,
        name: t.events?.name || 'Unknown',
        date: t.events?.event_date || '',
        revenue: 0,
        sold: 0,
      };
      cur.revenue += Number(t.price || 0);
      cur.sold += 1;
      map.set(t.event_id, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [activeTickets]);

  // Vendor voucher cost ranking
  const vendorCosts = useMemo(() => {
    const map = new Map<string, { vendor: string; redeemed: number; cost: number }>();
    vouchers.filter(v => v.status === 'redeemed').forEach(v => {
      const name = v.vendors?.name || 'Unknown';
      const cur = map.get(name) || { vendor: name, redeemed: 0, cost: 0 };
      cur.redeemed += 1;
      cur.cost += Number(v.sponsor_cost || 0);
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost).slice(0, 8);
  }, [vouchers]);

  // Sponsor split (pie)
  const sponsorSplit = useMemo(() => {
    const map: Record<string, number> = {};
    vouchers.forEach(v => { map[v.sponsor] = (map[v.sponsor] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [vouchers]);

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Events Analytics</h1>
            <p className="text-sm text-muted-foreground">Platform-wide ticket sales, attendance, and voucher costs.</p>
          </div>
          <div className="flex gap-1.5">
            {(['7', '30', '90', 'all'] as const).map(r => (
              <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>
                {r === 'all' ? 'All time' : `${r}d`}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => navigate('/admin/events')}>Manage Events</Button>
          </div>
        </div>

        {loading ? <p className="text-muted-foreground">Loading…</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <Kpi icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={`₦${totals.revenue.toLocaleString()}`} />
              <Kpi icon={<Ticket className="w-4 h-4" />} label="Tickets Sold" value={totals.sold.toLocaleString()} />
              <Kpi icon={<Users className="w-4 h-4" />} label="Buyers" value={totals.buyers.toLocaleString()} />
              <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Check-ins" value={totals.checkedIn.toLocaleString()} sub={`${totals.sold ? Math.round((totals.checkedIn / totals.sold) * 100) : 0}%`} />
              <Kpi icon={<Calendar className="w-4 h-4" />} label="Upcoming" value={`${totals.upcoming}/${totals.eventCount}`} />
              <Kpi icon={<Gift className="w-4 h-4" />} label="Vouchers" value={`${voucherStats.redeemed}/${voucherStats.total}`} sub={`₦${voucherStats.cost.toLocaleString()} cost`} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card title="Revenue Trend">
                {revenueTrend.length === 0 ? <Empty /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={revenueTrend}>
                      <defs>
                        <linearGradient id="rev2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => format(parseISO(d), 'MMM d')} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any, n: string) => n === 'revenue' ? `₦${Number(v).toLocaleString()}` : v} labelFormatter={(d) => format(parseISO(d as string), 'MMM d')} />
                      <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card title="Voucher Sponsor Split">
                {sponsorSplit.length === 0 ? <Empty /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={sponsorSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {sponsorSplit.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            <Card title="Top Events by Revenue">
              {topEvents.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-2 px-2">Event</th>
                        <th className="text-left py-2 px-2">Date</th>
                        <th className="text-right py-2 px-2">Tickets</th>
                        <th className="text-right py-2 px-2">Revenue</th>
                        <th className="text-right py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {topEvents.map(e => (
                        <tr key={e.event_id} className="border-b border-border/50">
                          <td className="py-2 px-2 font-medium">{e.name}</td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">{e.date ? format(parseISO(e.date), 'MMM d, yyyy') : '—'}</td>
                          <td className="py-2 px-2 text-right">{e.sold}</td>
                          <td className="py-2 px-2 text-right font-semibold">₦{e.revenue.toLocaleString()}</td>
                          <td className="py-2 px-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/admin/events/${e.event_id}/dashboard`)}>View</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {vendorCosts.length > 0 && (
              <Card title="Top Vendors by Voucher Cost">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={vendorCosts} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${v}`} />
                    <YAxis dataKey="vendor" type="category" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip formatter={(v: any) => `₦${Number(v).toLocaleString()}`} />
                    <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
          </>
        )}
      </div>
    </AdminLayout>
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
function Card({ title, children }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Empty() { return <p className="text-sm text-muted-foreground py-8 text-center">No data in this period</p>; }
