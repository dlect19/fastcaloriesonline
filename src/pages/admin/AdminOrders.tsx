import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, XCircle, Eye, Search, Gift, DollarSign, Clock, CheckCircle2 } from 'lucide-react';
import { format, differenceInMinutes, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { AdminCancelOrderDialog } from '@/components/admin/AdminCancelOrderDialog';
import { AdminOrderTrackingDialog } from '@/components/admin/AdminOrderTrackingDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangeFilter, type DateRange } from '@/components/shared/DateRangeFilter';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { Switch } from '@/components/ui/switch';

const ONGOING_STATUSES = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'];
const PAST_STATUSES = ['delivered', 'cancelled'];

export default function AdminOrders() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cancelOrder, setCancelOrder] = useState<any | null>(null);
  const [trackOrder, setTrackOrder] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [orderTab, setOrderTab] = useState<'all' | 'ongoing' | 'past'>('all');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [freeMealOnly, setFreeMealOnly] = useState(false);
  const [freeMealStats, setFreeMealStats] = useState({ total: 0, claimed: 0, pending: 0, expired: 0, totalValue: 0 });

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('admin-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [statusFilter]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [orderTab, dateRange, searchQuery, statusFilter, itemsPerPage, freeMealOnly]);

  const filteredOrders = useMemo(() => {
    let result = orders;

    // Tab filter
    if (orderTab === 'ongoing') result = result.filter(o => ONGOING_STATUSES.includes(o.status));
    if (orderTab === 'past') result = result.filter(o => PAST_STATUSES.includes(o.status));

    // Free meal filter
    if (freeMealOnly) result = result.filter(o => o.is_free_meal);

    // Date range filter
    if (dateRange.from) {
      result = result.filter(o => {
        const d = new Date(o.created_at);
        return isWithinInterval(d, {
          start: startOfDay(dateRange.from!),
          end: dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from!),
        });
      });
    }

    // Search
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(o =>
        o.order_number?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_phone?.toLowerCase().includes(q) ||
        o.vendors?.name?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [orders, orderTab, dateRange, searchQuery, freeMealOnly]);

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredOrders.slice(start, start + itemsPerPage);
  }, [filteredOrders, currentPage, itemsPerPage]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select('*, vendors(name)')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as "pending" | "confirmed" | "preparing" | "ready_for_pickup" | "picked_up" | "on_the_way" | "delivered" | "cancelled");
      }

      const { data } = await query;
      
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(o => o.user_id).filter(Boolean))];
        const riderIds = [...new Set(data.map(o => o.rider_id).filter(Boolean))];

        const [profilesRes, riderProfilesRes, riderNamesRes] = await Promise.all([
          supabase.from('profiles').select('user_id, full_name, phone').in('user_id', userIds),
          riderIds.length > 0
            ? supabase.from('rider_profiles').select('user_id, vehicle_type').in('user_id', riderIds)
            : { data: [] },
          riderIds.length > 0
            ? supabase.from('profiles').select('user_id, full_name, phone').in('user_id', riderIds)
            : { data: [] },
        ]);

        const profileMap = new Map(profilesRes.data?.map(p => [p.user_id, p]) || []);
        const riderProfileMap = new Map((riderProfilesRes.data || []).map((r: any) => [r.user_id, r]));
        const riderNameMap = new Map((riderNamesRes.data || []).map((r: any) => [r.user_id, r]));

        const enriched = data.map(order => ({
          ...order,
          customer_name: profileMap.get(order.user_id)?.full_name || 'N/A',
          customer_phone: profileMap.get(order.user_id)?.phone || 'N/A',
          rider_name: order.rider_id ? (riderNameMap.get(order.rider_id)?.full_name || 'Assigned') : null,
          rider_vehicle: order.rider_id ? (riderProfileMap.get(order.rider_id)?.vehicle_type || null) : null,
        }));
        setOrders(enriched);

        // Compute free meal stats from audit table
        const freeMealOrders = data.filter((o: any) => o.is_free_meal);
        const totalValue = freeMealOrders.reduce((s: number, o: any) => s + (Number(o.free_meal_value) || 0), 0);
        
        // Also get audit stats
        const { data: auditData } = await supabase
          .from('free_meal_audit')
          .select('status, platform_cost');
        
        let claimed = 0, pending = 0, expired = 0;
        auditData?.forEach((a: any) => {
          if (a.status === 'claimed' || a.status === 'vendor_paid') claimed += a.platform_cost || 0;
          else if (a.status === 'in_progress' || a.status === 'qualified') pending += a.platform_cost || 0;
          else if (a.status === 'expired') expired += a.platform_cost || 0;
        });

        setFreeMealStats({
          total: freeMealOrders.length,
          claimed,
          pending,
          expired,
          totalValue,
        });
      } else {
        setOrders([]);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) navigate('/admin/auth');
  };

  const getAttentionLight = (order: any) => {
    const needsAttention = ['pending', 'confirmed'].includes(order.status);
    if (!needsAttention) return null;
    const mins = differenceInMinutes(new Date(), new Date(order.created_at));
    if (mins >= 5) return { color: 'bg-red-500', pulse: true, label: `${mins}m — Needs immediate attention!` };
    if (mins >= 3) return { color: 'bg-yellow-400', pulse: false, label: `${mins}m — Approaching 5 min limit` };
    return { color: 'bg-green-500', pulse: false, label: `${mins}m — Within time` };
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-calorie-medium text-white',
      confirmed: 'bg-blue-500 text-white',
      preparing: 'bg-purple-500 text-white',
      ready_for_pickup: 'bg-indigo-500 text-white',
      picked_up: 'bg-cyan-500 text-white',
      on_the_way: 'bg-teal-500 text-white',
      delivered: 'bg-calorie-low text-white',
      cancelled: 'bg-destructive text-white',
    };
    return <Badge className={colors[status] || 'bg-secondary'}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const ongoingCount = orders.filter(o => ONGOING_STATUSES.includes(o.status)).length;
  const pastCount = orders.filter(o => PAST_STATUSES.includes(o.status)).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Orders</h1>
            <p className="text-muted-foreground">View and manage all platform orders</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search order #, customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-56"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="preparing">Preparing</SelectItem>
                <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                <SelectItem value="on_the_way">On the Way</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs + Date filter + Per-page selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <Tabs value={orderTab} onValueChange={(v) => setOrderTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">All ({orders.length})</TabsTrigger>
              <TabsTrigger value="ongoing">Ongoing ({ongoingCount})</TabsTrigger>
              <TabsTrigger value="past">Past ({pastCount})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Per page:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => setItemsPerPage(Number(v))}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Orders ({filteredOrders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium w-8"></th>
                    <th className="text-left py-3 px-4 font-medium">Order #</th>
                    <th className="text-left py-3 px-4 font-medium">Customer</th>
                    <th className="text-left py-3 px-4 font-medium">Phone</th>
                    <th className="text-left py-3 px-4 font-medium">Vendor</th>
                    <th className="text-left py-3 px-4 font-medium">Type</th>
                    <th className="text-left py-3 px-4 font-medium">Promo</th>
                     <th className="text-left py-3 px-4 font-medium">Status</th>
                     <th className="text-left py-3 px-4 font-medium">Rider</th>
                     <th className="text-left py-3 px-4 font-medium">Total</th>
                     <th className="text-left py-3 px-4 font-medium">Date</th>
                     <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.length === 0 ? (
                    <tr>
                     <td colSpan={12} className="py-12 text-center text-muted-foreground">
                         No orders found matching your filters
                       </td>
                    </tr>
                  ) : paginatedOrders.map((order) => {
                    const light = getAttentionLight(order);
                    return (
                      <tr key={order.id} className={`border-b hover:bg-secondary/50 ${light?.color === 'bg-red-500' ? 'bg-destructive/5' : ''}`}>
                        <td className="py-3 px-4">
                          {light && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className={`inline-block w-3 h-3 rounded-full ${light.color} ${light.pulse ? 'animate-pulse' : ''}`} />
                                </TooltipTrigger>
                                <TooltipContent><p>{light.label}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </td>
                        <td className="py-3 px-4 font-medium">{order.order_number}</td>
                        <td className="py-3 px-4">{order.customer_name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{order.customer_phone}</td>
                        <td className="py-3 px-4">{order.vendors?.name}</td>
                        <td className="py-3 px-4">
                          {order.delivery_type === 'self_pickup' ? (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">🏪 Carryout</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">🚚 Delivery</Badge>
                          )}
                         </td>
                        <td className="py-3 px-4">
                          {order.promo_code ? (
                            <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 text-xs font-mono">
                              🏷️ {order.promo_code}
                            </Badge>
                          ) : order.discount > 0 ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              -₦{Number(order.discount).toLocaleString()}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                         <td className="py-3 px-4">{getStatusBadge(order.status)}</td>
                         <td className="py-3 px-4">
                           {order.rider_name ? (
                             <span className="text-sm flex items-center gap-1">
                               <span className="text-primary">🏍️</span>
                               {order.rider_name}
                             </span>
                           ) : (
                             <span className="text-xs text-muted-foreground">—</span>
                           )}
                         </td>
                        <td className="py-3 px-4">₦{Number(order.total).toLocaleString()}</td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {format(new Date(order.created_at), 'PP')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setTrackOrder(order)}>
                              <Eye className="w-4 h-4" /> Track
                            </Button>
                            {order.status !== 'cancelled' && order.status !== 'delivered' && (
                              <Button
                                variant="ghost" size="sm"
                                className="text-destructive hover:text-destructive gap-1"
                                onClick={() => setCancelOrder(order)}
                              >
                                <XCircle className="w-4 h-4" /> Cancel
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredOrders.length}
              itemsPerPage={itemsPerPage}
            />
          </CardContent>
        </Card>

        {cancelOrder && (
          <AdminCancelOrderDialog
            open={!!cancelOrder}
            onOpenChange={(open) => !open && setCancelOrder(null)}
            orderId={cancelOrder.id}
            orderNumber={cancelOrder.order_number}
            orderTotal={Number(cancelOrder.total)}
            paymentStatus={cancelOrder.payment_status}
            onCancelled={() => { setCancelOrder(null); fetchOrders(); }}
          />
        )}

        <AdminOrderTrackingDialog
          open={!!trackOrder}
          onOpenChange={(open) => !open && setTrackOrder(null)}
          order={trackOrder}
          onUpdated={fetchOrders}
        />
    </AdminLayout>
  );
}
