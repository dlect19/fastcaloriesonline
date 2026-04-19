import { useEffect, useMemo, useState } from 'react';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { useOutletContext } from '@/hooks/useOutletContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Receipt,
  TrendingUp,
  Package,
  Clock,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';

type Range = 'today' | '7d' | '30d';

type OrderRow = {
  id: string;
  total: number;
  payment_method: string | null;
  pos_payment_method: string | null;
  pos_cashier_id: string | null;
  created_at: string;
  channel: string | null;
};

type OrderItemRow = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  subtotal: number;
  created_at: string;
  orders: { created_at: string; vendor_id: string; outlet_id: string | null; channel: string | null } | null;
};

type StockProduct = {
  id: string;
  name: string;
  stock_quantity: number | null;
  track_stock: boolean | null;
  is_available: boolean | null;
  price: number;
  outlet_id: string | null;
};

const startOfRange = (r: Range): Date => {
  const now = new Date();
  if (r === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = r === '7d' ? 7 : 30;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
};

export default function VendorPosReports() {
  const navigate = useNavigate();
  const { selectedOutlet } = useOutletContext();
  const outletId = selectedOutlet?.id ?? null;

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('today');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [stock, setStock] = useState<StockProduct[]>([]);
  const [cashiers, setCashiers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Resolve vendor id
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: v } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
      if (v) { setVendorId(v.id); return; }
      const { data: s } = await supabase.from('vendor_staff').select('vendor_id').eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (s) setVendorId(s.vendor_id);
    })();
  }, []);

  // Fetch data when vendor / range / outlet changes
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = startOfRange(range).toISOString();

      let ordersQ = supabase
        .from('orders')
        .select('id, total, payment_method, pos_payment_method, pos_cashier_id, created_at, channel')
        .eq('vendor_id', vendorId)
        .eq('channel', 'pos')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (outletId) ordersQ = ordersQ.eq('outlet_id', outletId);

      const [{ data: ord }, { data: prods }] = await Promise.all([
        ordersQ,
        (async () => {
          let q = supabase
            .from('products')
            .select('id, name, stock_quantity, track_stock, is_available, price, outlet_id')
            .eq('vendor_id', vendorId);
          if (outletId) q = q.or(`outlet_id.eq.${outletId},outlet_id.is.null`);
          return q;
        })(),
      ]);
      if (cancelled) return;

      const orderRows = (ord || []) as OrderRow[];
      setOrders(orderRows);
      setStock((prods || []) as StockProduct[]);

      // Fetch order_items joined with parent order created_at for hourly heatmap
      if (orderRows.length > 0) {
        const orderIds = orderRows.map(o => o.id);
        const { data: it } = await supabase
          .from('order_items')
          .select('product_id, product_name, quantity, subtotal, created_at, orders!inner(created_at, vendor_id, outlet_id, channel)')
          .in('order_id', orderIds);
        if (!cancelled) setItems((it || []) as any);
      } else {
        setItems([]);
      }

      // Resolve cashier display names
      const cashierIds = Array.from(new Set(orderRows.map(o => o.pos_cashier_id).filter(Boolean))) as string[];
      if (cashierIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', cashierIds);
        if (!cancelled) {
          const map: Record<string, string> = {};
          (profs || []).forEach((p: any) => { map[p.user_id] = p.full_name || 'Cashier'; });
          setCashiers(map);
        }
      } else {
        setCashiers({});
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [vendorId, range, outletId]);

  // ==== Aggregations ====
  const totals = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const count = orders.length;
    const avg = count > 0 ? revenue / count : 0;
    return { revenue, count, avg };
  }, [orders]);

  const byPaymentMethod = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const o of orders) {
      const m = (o.pos_payment_method || o.payment_method || 'unknown').toLowerCase();
      if (!map[m]) map[m] = { count: 0, total: 0 };
      map[m].count += 1;
      map[m].total += Number(o.total || 0);
    }
    return map;
  }, [orders]);

  const byCashier = useMemo(() => {
    const map: Record<string, { count: number; total: number; name: string }> = {};
    for (const o of orders) {
      const id = o.pos_cashier_id || 'unknown';
      if (!map[id]) map[id] = { count: 0, total: 0, name: cashiers[id] || (id === 'unknown' ? 'Unknown' : 'Cashier') };
      map[id].count += 1;
      map[id].total += Number(o.total || 0);
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [orders, cashiers]);

  const topItems = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const it of items) {
      const key = it.product_id || it.product_name;
      if (!map[key]) map[key] = { name: it.product_name, qty: 0, revenue: 0 };
      map[key].qty += Number(it.quantity || 0);
      map[key].revenue += Number(it.subtotal || 0);
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 20);
  }, [items]);

  // Hourly heatmap (24 columns x N rows of top items)
  const heatmap = useMemo(() => {
    type Row = { name: string; perHour: number[]; total: number };
    const map = new Map<string, Row>();
    for (const it of items) {
      const created = new Date(it.orders?.created_at || it.created_at);
      const hour = created.getHours();
      const key = it.product_id || it.product_name;
      let row = map.get(key);
      if (!row) {
        row = { name: it.product_name, perHour: Array(24).fill(0), total: 0 };
        map.set(key, row);
      }
      row.perHour[hour] += Number(it.quantity || 0);
      row.total += Number(it.quantity || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 12);
  }, [items]);

  const hottestHour = useMemo(() => {
    const buckets = Array(24).fill(0);
    for (const it of items) {
      const h = new Date(it.orders?.created_at || it.created_at).getHours();
      buckets[h] += Number(it.quantity || 0);
    }
    let best = 0;
    for (let i = 1; i < 24; i++) if (buckets[i] > buckets[best]) best = i;
    return { hour: best, qty: buckets[best] };
  }, [items]);

  const stockReport = useMemo(() => {
    const tracked = stock.filter(s => s.track_stock);
    const out = tracked.filter(s => (s.stock_quantity ?? 0) <= 0);
    const low = tracked.filter(s => (s.stock_quantity ?? 0) > 0 && (s.stock_quantity ?? 0) <= 5);
    const onHandValue = tracked.reduce((sum, s) => sum + (s.stock_quantity ?? 0) * Number(s.price || 0), 0);
    return { tracked, out, low, onHandValue };
  }, [stock]);

  const exportCsv = () => {
    const rows: string[] = [];
    rows.push(['Date', 'Order ID', 'Total (NGN)', 'Method', 'Cashier'].join(','));
    for (const o of orders) {
      rows.push([
        new Date(o.created_at).toLocaleString(),
        o.id,
        o.total,
        (o.pos_payment_method || o.payment_method || ''),
        (cashiers[o.pos_cashier_id || ''] || ''),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-sales-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <VendorLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/vendor/pos')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-primary" /> POS Reports
              </h1>
              <p className="text-xs text-muted-foreground">In-store sales, inventory & top movers.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-card p-0.5">
              {(['today', '7d', '30d'] as Range[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={orders.length === 0}>
              <Download className="w-4 h-4 mr-1.5" /> CSV
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Revenue" value={`₦${totals.revenue.toLocaleString()}`} icon={Receipt} />
          <KpiCard label="POS Sales" value={totals.count.toString()} icon={TrendingUp} />
          <KpiCard label="Avg Ticket" value={`₦${totals.avg.toFixed(0)}`} icon={Receipt} />
          <KpiCard
            label="Peak Hour"
            value={hottestHour.qty > 0 ? `${pad(hottestHour.hour)}:00` : '—'}
            sub={hottestHour.qty > 0 ? `${hottestHour.qty} items` : 'No sales'}
            icon={Clock}
          />
        </div>

        <Tabs defaultValue="sales" className="w-full">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="top">Top Items</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="heatmap">Hourly</TabsTrigger>
          </TabsList>

          {/* Sales tab */}
          <TabsContent value="sales" className="space-y-3 mt-3">
            <Card className="p-4">
              <h3 className="font-semibold mb-3">By Payment Method</h3>
              {Object.keys(byPaymentMethod).length === 0 ? (
                <p className="text-sm text-muted-foreground">No POS sales in this range.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(byPaymentMethod).map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-sm">
                      <span className="capitalize font-medium">{m}</span>
                      <span className="text-muted-foreground">
                        {v.count} sales · <span className="text-foreground font-semibold">₦{v.total.toLocaleString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">By Cashier</h3>
              {byCashier.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cashier data yet.</p>
              ) : (
                <div className="space-y-2">
                  {byCashier.map(([id, v]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{v.name}</span>
                      <span className="text-muted-foreground">
                        {v.count} sales · <span className="text-foreground font-semibold">₦{v.total.toLocaleString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Top items */}
          <TabsContent value="top" className="mt-3">
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Most Sold (qty)</h3>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : topItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items sold in this range.</p>
              ) : (
                <div className="space-y-2">
                  {topItems.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-bold text-muted-foreground w-6">#{i + 1}</span>
                        <span className="truncate font-medium">{t.name}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold">{t.qty} sold</p>
                        <p className="text-[11px] text-muted-foreground">₦{t.revenue.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Stock report */}
          <TabsContent value="stock" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard label="Tracked SKUs" value={stockReport.tracked.length.toString()} icon={Package} />
              <KpiCard label="Out of Stock" value={stockReport.out.length.toString()} icon={AlertTriangle} accent="danger" />
              <KpiCard label="Stock Value" value={`₦${stockReport.onHandValue.toLocaleString()}`} icon={Package} />
            </div>
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center justify-between">
                Low / Out of Stock
                <Badge variant="outline" className="text-[10px]">{stockReport.out.length + stockReport.low.length}</Badge>
              </h3>
              {stockReport.out.length + stockReport.low.length === 0 ? (
                <p className="text-sm text-muted-foreground">All tracked items healthy. 🎉</p>
              ) : (
                <ScrollArea className="max-h-80">
                  <div className="space-y-1.5">
                    {[...stockReport.out, ...stockReport.low].map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0">
                        <span className="truncate">{p.name}</span>
                        <Badge variant={p.stock_quantity ? 'outline' : 'destructive'} className="text-[10px]">
                          {p.stock_quantity ? `${p.stock_quantity} left` : 'Out'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </Card>
          </TabsContent>

          {/* Heatmap */}
          <TabsContent value="heatmap" className="mt-3">
            <Card className="p-4 overflow-x-auto">
              <h3 className="font-semibold mb-3">When does each item sell? (qty per hour)</h3>
              {heatmap.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales data yet.</p>
              ) : (
                <div className="min-w-[720px]">
                  <div className="grid" style={{ gridTemplateColumns: '180px repeat(24, 1fr)' }}>
                    <div className="text-[10px] text-muted-foreground" />
                    {Array.from({ length: 24 }).map((_, h) => (
                      <div key={h} className="text-[9px] text-center text-muted-foreground">{pad(h)}</div>
                    ))}
                    {heatmap.map(row => {
                      const max = Math.max(...row.perHour, 1);
                      return (
                        <div key={row.name} className="contents">
                          <div className="text-xs py-1 truncate pr-2 font-medium border-t flex items-center">{row.name}</div>
                          {row.perHour.map((qty, h) => {
                            const intensity = qty === 0 ? 0 : Math.max(0.12, qty / max);
                            return (
                              <div key={h} className="border-t border-l py-1 px-0.5 text-center text-[10px]">
                                <div
                                  className="rounded mx-auto"
                                  style={{
                                    backgroundColor: qty > 0 ? `hsl(var(--primary) / ${intensity})` : 'transparent',
                                    width: '100%',
                                    height: '18px',
                                    color: intensity > 0.6 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                                    lineHeight: '18px',
                                  }}
                                >
                                  {qty || ''}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </VendorLayout>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Receipt;
  accent?: 'danger';
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <Icon className={cn('w-4 h-4', accent === 'danger' ? 'text-destructive' : 'text-primary')} />
      </div>
      <p className={cn('text-xl md:text-2xl font-bold mt-1', accent === 'danger' && 'text-destructive')}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}
