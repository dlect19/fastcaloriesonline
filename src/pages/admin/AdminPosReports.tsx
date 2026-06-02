import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Receipt, TrendingUp, Store, Search, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

type Range = 'today' | '7d' | '30d' | 'all';

interface OrderRow {
  id: string;
  vendor_id: string;
  total: number;
  pos_payment_method: string | null;
  payment_method: string | null;
  created_at: string;
}

interface VendorRow {
  id: string;
  name: string;
  category: string | null;
}

const startOfRange = (r: Range): Date | null => {
  if (r === 'all') return null;
  const d = new Date();
  if (r === 'today') { d.setHours(0, 0, 0, 0); return d; }
  const days = r === '7d' ? 7 : 30;
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
};

export default function AdminPosReports() {
  const [range, setRange] = useState<Range>('today');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [vendors, setVendors] = useState<Record<string, VendorRow>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [vendorItems, setVendorItems] = useState<Record<string, any[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('orders')
        .select('id, vendor_id, total, pos_payment_method, payment_method, created_at')
        .eq('channel', 'pos')
        .order('created_at', { ascending: false })
        .limit(5000);
      const since = startOfRange(range);
      if (since) q = q.gte('created_at', since.toISOString());
      const { data: ord } = await q;
      if (cancelled) return;
      const rows = (ord || []) as OrderRow[];
      setOrders(rows);

      const vendorIds = Array.from(new Set(rows.map(o => o.vendor_id).filter(Boolean)));
      if (vendorIds.length > 0) {
        const { data: vs } = await supabase
          .from('vendors')
          .select('id, name, category')
          .in('id', vendorIds);
        const map: Record<string, VendorRow> = {};
        (vs || []).forEach((v: any) => { map[v.id] = v; });
        if (!cancelled) setVendors(map);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range]);

  const byVendor = useMemo(() => {
    const map: Record<string, { vendorId: string; count: number; revenue: number; methods: Record<string, number> }> = {};
    for (const o of orders) {
      const id = o.vendor_id;
      if (!map[id]) map[id] = { vendorId: id, count: 0, revenue: 0, methods: {} };
      map[id].count += 1;
      map[id].revenue += Number(o.total || 0);
      const m = (o.pos_payment_method || o.payment_method || 'unknown').toLowerCase();
      map[id].methods[m] = (map[id].methods[m] || 0) + Number(o.total || 0);
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [orders]);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byVendor;
    return byVendor.filter(v => (vendors[v.vendorId]?.name || '').toLowerCase().includes(q));
  }, [byVendor, search, vendors]);

  const totals = useMemo(() => ({
    revenue: orders.reduce((s, o) => s + Number(o.total || 0), 0),
    count: orders.length,
    vendors: byVendor.length,
  }), [orders, byVendor]);

  const toggleVendor = async (vendorId: string) => {
    if (expanded === vendorId) { setExpanded(null); return; }
    setExpanded(vendorId);
    if (vendorItems[vendorId]) return;
    const vendorOrderIds = orders.filter(o => o.vendor_id === vendorId).map(o => o.id);
    if (vendorOrderIds.length === 0) return;
    const { data } = await supabase
      .from('order_items')
      .select('order_id, product_name, quantity, unit_price, total_price')
      .in('order_id', vendorOrderIds.slice(0, 500));
    setVendorItems(prev => ({ ...prev, [vendorId]: (data || []) as any[] }));
  };

  const exportCsv = () => {
    const rows: string[] = [];
    rows.push(['Vendor', 'Category', 'POS Sales', 'Revenue (NGN)'].join(','));
    for (const v of filteredVendors) {
      const ven = vendors[v.vendorId];
      rows.push([
        ven?.name || v.vendorId,
        ven?.category || '',
        v.count,
        v.revenue,
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-sales-by-vendor-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" /> POS Sales by Vendor
            </h1>
            <p className="text-xs text-muted-foreground">In-store POS sales across all vendors.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
              <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="7d">7d</TabsTrigger>
                <TabsTrigger value="30d">30d</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={orders.length === 0}>
              <Download className="w-4 h-4 mr-1.5" /> CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold text-primary mt-1">₦{totals.revenue.toLocaleString()}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">POS Sales</p>
            <p className="text-2xl font-bold mt-1">{totals.count.toLocaleString()}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Vendors</p>
            <p className="text-2xl font-bold mt-1">{totals.vendors}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vendor name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Card className="p-0 overflow-hidden">
          <ScrollArea className="max-h-[600px]">
            {loading ? (
              <div className="p-12 text-center text-muted-foreground text-sm">Loading…</div>
            ) : filteredVendors.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No POS sales in this period.
              </div>
            ) : (
              <div className="divide-y">
                {filteredVendors.map(v => {
                  const ven = vendors[v.vendorId];
                  const isOpen = expanded === v.vendorId;
                  const its = vendorItems[v.vendorId] || [];
                  return (
                    <div key={v.vendorId}>
                      <button
                        onClick={() => toggleVendor(v.vendorId)}
                        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/40 text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Store className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{ven?.name || v.vendorId.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {ven?.category || '—'} · {v.count} sales
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-sm">₦{v.revenue.toLocaleString()}</p>
                          <div className="flex gap-1 mt-0.5 justify-end">
                            {Object.entries(v.methods).slice(0, 3).map(([m, amt]) => (
                              <Badge key={m} variant="outline" className="text-[9px] capitalize px-1 py-0">
                                {m}: ₦{Math.round(amt).toLocaleString()}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="bg-muted/30 px-4 py-3 border-t">
                          {its.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No item details available.</p>
                          ) : (
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {Object.values(its.reduce((acc: any, it: any) => {
                                const key = it.product_name;
                                if (!acc[key]) acc[key] = { name: key, qty: 0, revenue: 0 };
                                acc[key].qty += Number(it.quantity || 0);
                                acc[key].revenue += Number(it.total_price || 0);
                                return acc;
                              }, {} as Record<string, any>))
                                .sort((a: any, b: any) => b.qty - a.qty)
                                .map((row: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-xs">
                                    <span className="truncate pr-2">
                                      <span className="font-medium">{row.qty}×</span> {row.name}
                                    </span>
                                    <span className="text-muted-foreground shrink-0">
                                      ₦{Math.round(row.revenue).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>
    </AdminLayout>
  );
}
