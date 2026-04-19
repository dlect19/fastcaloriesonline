import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Pill, TrendingUp, Users, Search, Store, Calendar } from 'lucide-react';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { DateRangeFilter, type DateRange } from '@/components/shared/DateRangeFilter';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface DrugRow {
  product_id: string | null;
  product_name: string;
  total_qty: number;
  total_revenue: number;
  unique_customers: Set<string>;
  unique_orders: Set<string>;
}

interface PharmacyRow {
  vendor_id: string;
  vendor_name: string;
  total_orders: Set<string>;
  total_revenue: number;
  total_units: number;
  top_drug: { name: string; qty: number };
  drugs: Map<string, number>;
}

interface CustomerHistoryRow {
  user_id: string;
  customer_name: string;
  customer_phone: string | null;
  total_qty: number;
  total_spent: number;
  last_purchase: string;
  order_count: number;
}

export default function AdminPharmacyAnalytics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [drugRows, setDrugRows] = useState<DrugRow[]>([]);
  const [pharmacyRows, setPharmacyRows] = useState<PharmacyRow[]>([]);
  const [trendData, setTrendData] = useState<{ date: string; orders: number; units: number; revenue: number }[]>([]);
  const [drugSearch, setDrugSearch] = useState('');
  const [pharmacySearch, setPharmacySearch] = useState('');
  const [selectedDrug, setSelectedDrug] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<CustomerHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('drugs');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) navigate('/admin/auth');
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const fromDate = dateRange.from || subDays(new Date(), 30);
      const toDate = dateRange.to || new Date();

      // 1. Get all pharmacy vendor IDs
      const { data: pharmacyVendors } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('category', 'pharmacy');

      if (!pharmacyVendors || pharmacyVendors.length === 0) {
        setDrugRows([]);
        setPharmacyRows([]);
        setTrendData([]);
        setLoading(false);
        return;
      }

      const vendorMap = new Map(pharmacyVendors.map(v => [v.id, v.name]));
      const vendorIds = pharmacyVendors.map(v => v.id);

      // 2. Get pharmacy orders within date range (paid only)
      const { data: orders } = await supabase
        .from('orders')
        .select('id, vendor_id, user_id, total, created_at, payment_status')
        .in('vendor_id', vendorIds)
        .eq('payment_status', 'paid')
        .gte('created_at', startOfDay(fromDate).toISOString())
        .lte('created_at', new Date(toDate.getTime() + 86400000).toISOString())
        .limit(5000);

      if (!orders || orders.length === 0) {
        setDrugRows([]);
        setPharmacyRows([]);
        setTrendData([]);
        setLoading(false);
        return;
      }

      const orderIds = orders.map(o => o.id);
      const orderMap = new Map(orders.map(o => [o.id, o]));

      // 3. Get all order items
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity, total_price')
        .in('order_id', orderIds);

      if (!items) {
        setLoading(false);
        return;
      }

      // 4. Aggregate drugs
      const drugMap = new Map<string, DrugRow>();
      const pharmaMap = new Map<string, PharmacyRow>();

      items.forEach(item => {
        const order = orderMap.get(item.order_id);
        if (!order) return;
        const key = item.product_id || item.product_name;

        // Drug aggregation
        const existing = drugMap.get(key);
        if (existing) {
          existing.total_qty += item.quantity;
          existing.total_revenue += Number(item.total_price);
          if (order.user_id) existing.unique_customers.add(order.user_id);
          existing.unique_orders.add(order.id);
        } else {
          drugMap.set(key, {
            product_id: item.product_id,
            product_name: item.product_name,
            total_qty: item.quantity,
            total_revenue: Number(item.total_price),
            unique_customers: new Set(order.user_id ? [order.user_id] : []),
            unique_orders: new Set([order.id]),
          });
        }

        // Pharmacy aggregation
        const pharma = pharmaMap.get(order.vendor_id);
        if (pharma) {
          pharma.total_orders.add(order.id);
          pharma.total_revenue += Number(item.total_price);
          pharma.total_units += item.quantity;
          pharma.drugs.set(item.product_name, (pharma.drugs.get(item.product_name) || 0) + item.quantity);
        } else {
          const newDrugs = new Map<string, number>();
          newDrugs.set(item.product_name, item.quantity);
          pharmaMap.set(order.vendor_id, {
            vendor_id: order.vendor_id,
            vendor_name: vendorMap.get(order.vendor_id) || 'Unknown',
            total_orders: new Set([order.id]),
            total_revenue: Number(item.total_price),
            total_units: item.quantity,
            top_drug: { name: item.product_name, qty: item.quantity },
            drugs: newDrugs,
          });
        }
      });

      // Compute top_drug for each pharmacy
      pharmaMap.forEach(p => {
        let topName = '';
        let topQty = 0;
        p.drugs.forEach((qty, name) => {
          if (qty > topQty) { topQty = qty; topName = name; }
        });
        p.top_drug = { name: topName, qty: topQty };
      });

      const drugArr = Array.from(drugMap.values()).sort((a, b) => b.total_revenue - a.total_revenue);
      const pharmaArr = Array.from(pharmaMap.values()).sort((a, b) => b.total_revenue - a.total_revenue);

      setDrugRows(drugArr);
      setPharmacyRows(pharmaArr);

      // 5. Trends: orders/units/revenue per day
      const dayBuckets = new Map<string, { orders: Set<string>; units: number; revenue: number }>();
      const days = eachDayOfInterval({ start: fromDate, end: toDate });
      days.forEach(d => {
        dayBuckets.set(format(d, 'yyyy-MM-dd'), { orders: new Set(), units: 0, revenue: 0 });
      });

      items.forEach(item => {
        const order = orderMap.get(item.order_id);
        if (!order) return;
        const dayKey = format(new Date(order.created_at), 'yyyy-MM-dd');
        const bucket = dayBuckets.get(dayKey);
        if (bucket) {
          bucket.orders.add(order.id);
          bucket.units += item.quantity;
          bucket.revenue += Number(item.total_price);
        }
      });

      const trends = Array.from(dayBuckets.entries()).map(([date, b]) => ({
        date: format(new Date(date), 'MMM dd'),
        orders: b.orders.size,
        units: b.units,
        revenue: Math.round(b.revenue),
      }));
      setTrendData(trends);
    } catch (e) {
      console.error('Error fetching pharmacy analytics:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomerHistory = async (drugKey: string, productName: string) => {
    setLoadingHistory(true);
    setSelectedDrug(productName);
    setActiveTab('customers');
    try {
      const fromDate = dateRange.from || subDays(new Date(), 30);
      const toDate = dateRange.to || new Date();

      // Get pharmacy vendor IDs
      const { data: pharmacyVendors } = await supabase
        .from('vendors')
        .select('id')
        .eq('category', 'pharmacy');

      const vendorIds = (pharmacyVendors || []).map(v => v.id);
      if (vendorIds.length === 0) { setCustomerHistory([]); return; }

      // Get orders + items for this drug
      const { data: orders } = await supabase
        .from('orders')
        .select('id, user_id, created_at')
        .in('vendor_id', vendorIds)
        .eq('payment_status', 'paid')
        .gte('created_at', startOfDay(fromDate).toISOString())
        .lte('created_at', new Date(toDate.getTime() + 86400000).toISOString())
        .limit(5000);

      if (!orders || orders.length === 0) { setCustomerHistory([]); return; }

      const orderIds = orders.map(o => o.id);
      const orderMap = new Map(orders.map(o => [o.id, o]));

      // Filter items either by product_id or product_name
      let itemQuery = supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity, total_price')
        .in('order_id', orderIds);

      if (drugKey && drugKey !== productName) {
        itemQuery = itemQuery.eq('product_id', drugKey);
      } else {
        itemQuery = itemQuery.eq('product_name', productName);
      }

      const { data: items } = await itemQuery;
      if (!items) { setCustomerHistory([]); return; }

      // Aggregate by user
      const custMap = new Map<string, CustomerHistoryRow>();
      items.forEach(item => {
        const order = orderMap.get(item.order_id);
        if (!order || !order.user_id) return;
        const existing = custMap.get(order.user_id);
        if (existing) {
          existing.total_qty += item.quantity;
          existing.total_spent += Number(item.total_price);
          existing.order_count += 1;
          if (new Date(order.created_at) > new Date(existing.last_purchase)) {
            existing.last_purchase = order.created_at;
          }
        } else {
          custMap.set(order.user_id, {
            user_id: order.user_id,
            customer_name: 'Loading…',
            customer_phone: null,
            total_qty: item.quantity,
            total_spent: Number(item.total_price),
            last_purchase: order.created_at,
            order_count: 1,
          });
        }
      });

      // Fetch customer profiles
      const userIds = Array.from(custMap.keys());
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', userIds);

        profiles?.forEach(p => {
          const row = custMap.get(p.user_id);
          if (row) {
            row.customer_name = p.full_name || 'Unknown';
            row.customer_phone = p.phone;
          }
        });
      }

      setCustomerHistory(Array.from(custMap.values()).sort((a, b) => b.total_spent - a.total_spent));
    } catch (e) {
      console.error('Error fetching history:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Top-level KPIs
  const kpis = useMemo(() => {
    const totalRevenue = drugRows.reduce((s, d) => s + d.total_revenue, 0);
    const totalUnits = drugRows.reduce((s, d) => s + d.total_qty, 0);
    const totalOrders = new Set<string>();
    drugRows.forEach(d => d.unique_orders.forEach(o => totalOrders.add(o)));
    const totalCustomers = new Set<string>();
    drugRows.forEach(d => d.unique_customers.forEach(c => totalCustomers.add(c)));
    return {
      revenue: totalRevenue,
      units: totalUnits,
      orders: totalOrders.size,
      customers: totalCustomers.size,
      drugs: drugRows.length,
      pharmacies: pharmacyRows.length,
    };
  }, [drugRows, pharmacyRows]);

  const filteredDrugs = useMemo(() => {
    const q = drugSearch.toLowerCase().trim();
    if (!q) return drugRows;
    return drugRows.filter(d => d.product_name.toLowerCase().includes(q));
  }, [drugRows, drugSearch]);

  const filteredPharmacies = useMemo(() => {
    const q = pharmacySearch.toLowerCase().trim();
    if (!q) return pharmacyRows;
    return pharmacyRows.filter(p => p.vendor_name.toLowerCase().includes(q));
  }, [pharmacyRows, pharmacySearch]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Pill className="w-6 h-6 text-primary" />
            Pharmacy Analytics
          </h1>
          <p className="text-sm text-muted-foreground">Drug sales, pharmacy performance, and customer purchase insights</p>
        </div>
        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="text-lg font-bold text-foreground">₦{kpis.revenue.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Orders</p>
            <p className="text-lg font-bold text-foreground">{kpis.orders.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Units sold</p>
            <p className="text-lg font-bold text-foreground">{kpis.units.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Customers</p>
            <p className="text-lg font-bold text-foreground">{kpis.customers.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unique drugs</p>
            <p className="text-lg font-bold text-foreground">{kpis.drugs.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pharmacies</p>
            <p className="text-lg font-bold text-foreground">{kpis.pharmacies.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="drugs"><Pill className="w-4 h-4 mr-1" />Top Drugs</TabsTrigger>
          <TabsTrigger value="pharmacies"><Store className="w-4 h-4 mr-1" />Pharmacies</TabsTrigger>
          <TabsTrigger value="trends"><TrendingUp className="w-4 h-4 mr-1" />Trends</TabsTrigger>
          {selectedDrug && (
            <TabsTrigger value="customers"><Users className="w-4 h-4 mr-1" />Customers — {selectedDrug}</TabsTrigger>
          )}
        </TabsList>

        {/* Drugs Tab */}
        <TabsContent value="drugs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle>Top-selling Drugs</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search drug…"
                    value={drugSearch}
                    onChange={e => setDrugSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Drug</th>
                      <th className="py-2 px-3">Qty sold</th>
                      <th className="py-2 px-3">Revenue</th>
                      <th className="py-2 px-3">Orders</th>
                      <th className="py-2 px-3">Customers</th>
                      <th className="py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrugs.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No data for this period</td></tr>
                    ) : filteredDrugs.slice(0, 100).map((d, i) => (
                      <tr key={(d.product_id || d.product_name) + i} className="border-b hover:bg-secondary/40">
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 font-medium">{d.product_name}</td>
                        <td className="py-2 px-3">{d.total_qty.toLocaleString()}</td>
                        <td className="py-2 px-3 font-semibold text-primary">₦{d.total_revenue.toLocaleString()}</td>
                        <td className="py-2 px-3">{d.unique_orders.size}</td>
                        <td className="py-2 px-3">{d.unique_customers.size}</td>
                        <td className="py-2 px-3">
                          <button
                            className="text-xs text-primary hover:underline"
                            onClick={() => fetchCustomerHistory(d.product_id || d.product_name, d.product_name)}
                          >
                            View customers
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pharmacies Tab */}
        <TabsContent value="pharmacies">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle>Per-pharmacy breakdown</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search pharmacy…"
                    value={pharmacySearch}
                    onChange={e => setPharmacySearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Pharmacy</th>
                      <th className="py-2 px-3">Orders</th>
                      <th className="py-2 px-3">Units</th>
                      <th className="py-2 px-3">Revenue</th>
                      <th className="py-2 px-3">Top drug</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPharmacies.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No pharmacy sales in this period</td></tr>
                    ) : filteredPharmacies.map((p, i) => (
                      <tr key={p.vendor_id} className="border-b hover:bg-secondary/40">
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 font-medium">{p.vendor_name}</td>
                        <td className="py-2 px-3">{p.total_orders.size}</td>
                        <td className="py-2 px-3">{p.total_units.toLocaleString()}</td>
                        <td className="py-2 px-3 font-semibold text-primary">₦{p.total_revenue.toLocaleString()}</td>
                        <td className="py-2 px-3">
                          {p.top_drug.name ? (
                            <Badge variant="outline" className="text-xs">
                              {p.top_drug.name} ({p.top_drug.qty})
                            </Badge>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />Daily orders & units</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Line type="monotone" dataKey="orders" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Orders" />
                    <Line type="monotone" dataKey="units" stroke="hsl(var(--calorie-medium))" strokeWidth={2} dot={false} name="Units" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Daily revenue (₦)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => `₦${Number(v).toLocaleString()}`} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Customer History Tab */}
        {selectedDrug && (
          <TabsContent value="customers">
            <Card>
              <CardHeader>
                <CardTitle>Customers who bought "{selectedDrug}"</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingHistory ? (
                  <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left text-muted-foreground">
                          <th className="py-2 px-3">Customer</th>
                          <th className="py-2 px-3">Phone</th>
                          <th className="py-2 px-3">Times bought</th>
                          <th className="py-2 px-3">Total qty</th>
                          <th className="py-2 px-3">Total spent</th>
                          <th className="py-2 px-3">Last purchase</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerHistory.length === 0 ? (
                          <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No customer purchases found</td></tr>
                        ) : customerHistory.map(c => (
                          <tr key={c.user_id} className="border-b hover:bg-secondary/40">
                            <td className="py-2 px-3 font-medium">{c.customer_name}</td>
                            <td className="py-2 px-3 text-muted-foreground">{c.customer_phone || '—'}</td>
                            <td className="py-2 px-3">{c.order_count}</td>
                            <td className="py-2 px-3">{c.total_qty}</td>
                            <td className="py-2 px-3 font-semibold text-primary">₦{c.total_spent.toLocaleString()}</td>
                            <td className="py-2 px-3 text-muted-foreground">{format(new Date(c.last_purchase), 'PP')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </AdminLayout>
  );
}
