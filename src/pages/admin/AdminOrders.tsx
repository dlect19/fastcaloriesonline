import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, XCircle, Eye, Search, Gift, DollarSign, Clock, CheckCircle2, PhoneCall } from 'lucide-react';
import { useCall } from '@/components/call/CallProvider';
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
  const { startCall } = useCall();
  const isTerminal = (s: string) => ['delivered', 'cancelled', 'completed', 'refunded'].includes(s);
  const callVendor = (order: any) => {
    if (!order.vendors?.user_id) return;
    startCall({
      orderId: order.id,
      receiverId: order.vendors.user_id,
      callerRole: 'admin' as any,
      receiverRole: 'vendor',
      receiverName: order.vendors?.name || 'Vendor',
    });
  };
  const callRider = (order: any) => {
    if (!order.rider_id) return;
    startCall({
      orderId: order.id,
      receiverId: order.rider_id,
      callerRole: 'admin' as any,
      receiverRole: 'rider',
      receiverName: order.rider_name || 'Rider',
    });
  };
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cancelOrder, setCancelOrder] = useState<any | null>(null);
  const [trackOrder, setTrackOrder] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [orderTab, setOrderTab] = useState<'all' | 'ongoing' | 'past'>('all');
  const [channelTab, setChannelTab] = useState<'online' | 'pos' | 'whatsapp' | 'assisted'>('online');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [freeMealOnly, setFreeMealOnly] = useState(false);
  const [freeMealStats, setFreeMealStats] = useState({ total: 0, claimed: 0, pending: 0, expired: 0, cancelled: 0, totalValue: 0 });

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
  useEffect(() => { setCurrentPage(1); }, [orderTab, channelTab, dateRange, searchQuery, statusFilter, itemsPerPage, freeMealOnly]);

  const filteredOrders = useMemo(() => {
    let result = orders;

    // Channel tab
    if (channelTab === 'pos') result = result.filter(o => o.channel === 'pos');
    else if (channelTab === 'whatsapp') result = result.filter(o => o.channel === 'whatsapp');
    else if (channelTab === 'assisted') result = result.filter(o => o.channel === 'assisted');
    else result = result.filter(o => !['pos','whatsapp','assisted'].includes(o.channel));

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
  }, [orders, orderTab, channelTab, dateRange, searchQuery, freeMealOnly]);

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
        .select('*, vendors(name, user_id)')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as "pending" | "confirmed" | "preparing" | "ready_for_pickup" | "picked_up" | "on_the_way" | "delivered" | "cancelled");
      }

      const { data } = await query;
      
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(o => o.user_id).filter(Boolean))];
        const riderIds = [...new Set(data.map(o => o.rider_id).filter(Boolean))];
        const staffIds = [...new Set(data.map((o: any) => o.attended_by_staff_id).filter(Boolean))];

        const [profilesRes, riderProfilesRes, riderNamesRes, staffRes] = await Promise.all([
          supabase.from('profiles').select('user_id, full_name, phone').in('user_id', userIds),
          riderIds.length > 0
            ? supabase.from('rider_profiles').select('user_id, vehicle_type').in('user_id', riderIds)
            : { data: [] },
          riderIds.length > 0
            ? supabase.from('profiles').select('user_id, full_name, phone').in('user_id', riderIds)
            : { data: [] },
          staffIds.length > 0
            ? supabase.from('admin_staff').select('id, user_id, role, invite_email').in('id', staffIds)
            : { data: [] },
        ]);

        const profileMap = new Map(profilesRes.data?.map(p => [p.user_id, p]) || []);
        const riderProfileMap = new Map((riderProfilesRes.data || []).map((r: any) => [r.user_id, r]));
        const riderNameMap = new Map((riderNamesRes.data || []).map((r: any) => [r.user_id, r]));

        const staffUserIds = (staffRes.data || []).map((s: any) => s.user_id);
        const { data: staffProfiles } = staffUserIds.length > 0
          ? await supabase.from('profiles').select('user_id, full_name').in('user_id', staffUserIds)
          : { data: [] as any[] };
        const staffProfileMap = new Map((staffProfiles || []).map((p: any) => [p.user_id, p.full_name]));
        const staffMap = new Map((staffRes.data || []).map((s: any) => [s.id, {
          name: staffProfileMap.get(s.user_id) || s.invite_email || `Staff (${String(s.role).replace('_',' ')})`,
          role: s.role,
        }]));

        const enriched = data.map(order => ({
          ...order,
          customer_name: profileMap.get(order.user_id)?.full_name || order.receiver_name || 'N/A',
          customer_phone: profileMap.get(order.user_id)?.phone || order.receiver_phone || 'N/A',
          rider_name: order.rider_id ? (riderNameMap.get(order.rider_id)?.full_name || 'Assigned') : null,
          rider_vehicle: order.rider_id ? (riderProfileMap.get(order.rider_id)?.vehicle_type || null) : null,
          attended_by_name: (order as any).attended_by_staff_id ? staffMap.get((order as any).attended_by_staff_id)?.name || 'Staff' : null,
          attended_by_role: (order as any).attended_by_staff_id ? staffMap.get((order as any).attended_by_staff_id)?.role || null : null,
        }));
        setOrders(enriched);

        // Compute free meal stats from audit table
        const freeMealOrders = data.filter((o: any) => o.is_free_meal);
        const totalValue = freeMealOrders.reduce((s: number, o: any) => s + (Number(o.free_meal_value) || 0), 0);
        
        // Get audit stats for claimed/expired/cancelled
        const { data: auditData } = await supabase
          .from('free_meal_audit')
          .select('status, platform_cost');
        
        let claimed = 0, pending = 0, expired = 0, cancelled = 0;
        auditData?.forEach((a: any) => {
          if (a.status === 'claimed' || a.status === 'vendor_paid') claimed += a.platform_cost || 0;
          else if (a.status === 'expired') expired += a.platform_cost || 0;
          else if (a.status === 'cancelled') cancelled += a.platform_cost || 0;
        });

        // Pending = one active partial-progress reservation per customer+started-vendor pair
        const { data: progressData } = await supabase
          .from('free_meal_progress')
          .select('user_id, highest_order_amount, promo_id, period_start, qualifying_order_id, free_meal_promos!inner(vendor_id, meal_value, order_threshold, promo_period_days, is_active)')
          .gt('highest_order_amount', 0);

        const qualifyingOrderIds = [...new Set((progressData || []).map((p: any) => p.qualifying_order_id).filter(Boolean))] as string[];
        let vendorByOrderId = new Map<string, string>();

        if (qualifyingOrderIds.length > 0) {
          const { data: qualifyingOrders } = await supabase
            .from('orders')
            .select('id, vendor_id')
            .in('id', qualifyingOrderIds);
          vendorByOrderId = new Map((qualifyingOrders || []).map((o: any) => [o.id, o.vendor_id]));
        }

        const now = new Date();
        const countedPendingKeys = new Set<string>();

        progressData?.forEach((p: any) => {
          const promo = p.free_meal_promos;
          if (!promo?.is_active) return;

          const startedVendorId = p.qualifying_order_id ? vendorByOrderId.get(p.qualifying_order_id) : null;
          if (!startedVendorId || promo.vendor_id !== startedVendorId) return;

          const periodStart = new Date(p.period_start);
          const periodEnd = new Date(periodStart);
          periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
          if (now > periodEnd) return;

          const progressPct = (p.highest_order_amount / promo.order_threshold) * 100;
          if (progressPct <= 0 || progressPct >= 100) return;

          const pendingKey = `${p.user_id}:${startedVendorId}`;
          if (countedPendingKeys.has(pendingKey)) return;

          countedPendingKeys.add(pendingKey);
          pending += promo.meal_value || 0;
        });

        setFreeMealStats({
          total: freeMealOrders.length,
          claimed,
          pending,
          expired,
          cancelled,
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

  const onlineOrders = orders.filter(o => !['pos','whatsapp','assisted'].includes(o.channel));
  const posOrders = orders.filter(o => o.channel === 'pos');
  const whatsappOrders = orders.filter(o => o.channel === 'whatsapp');
  const assistedOrders = orders.filter(o => o.channel === 'assisted');
  const channelOrders = channelTab === 'pos' ? posOrders : channelTab === 'whatsapp' ? whatsappOrders : channelTab === 'assisted' ? assistedOrders : onlineOrders;
  const ongoingCount = channelOrders.filter(o => ONGOING_STATUSES.includes(o.status)).length;
  const pastCount = channelOrders.filter(o => PAST_STATUSES.includes(o.status)).length;

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

        {/* Free Meal Financial Summary Cards */}
        {(freeMealStats.total > 0 || freeMealStats.pending > 0 || freeMealStats.claimed > 0) && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Free Meal Orders</span>
                </div>
                <p className="text-lg font-bold text-foreground">{freeMealStats.total}</p>
                <p className="text-xs text-muted-foreground">₦{freeMealStats.totalValue.toLocaleString()} total value</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Pending (Reserved)</span>
                </div>
                <p className="text-lg font-bold text-foreground">₦{freeMealStats.pending.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">From platform profit</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Claimed (Spent)</span>
                </div>
                <p className="text-lg font-bold text-foreground">₦{freeMealStats.claimed.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Deducted from profit</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-4 h-4 text-destructive" />
                  <span className="text-xs text-muted-foreground">Expired (Unused)</span>
                </div>
                <p className="text-lg font-bold text-foreground">₦{freeMealStats.expired.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Returned to profit</p>
              </CardContent>
            </Card>
            {freeMealStats.cancelled > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Cancelled (Restored)</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">₦{freeMealStats.cancelled.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Returned to customer</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Channel switcher: Online vs POS */}
        <Tabs value={channelTab} onValueChange={(v) => setChannelTab(v as any)} className="mb-3">
          <TabsList>
            <TabsTrigger value="online">🌐 Online ({onlineOrders.length})</TabsTrigger>
            <TabsTrigger value="whatsapp">💬 WhatsApp ({whatsappOrders.length})</TabsTrigger>
            <TabsTrigger value="assisted">🎧 Assisted ({assistedOrders.length})</TabsTrigger>
            <TabsTrigger value="pos">🧾 POS ({posOrders.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tabs + Date filter + Per-page selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <Tabs value={orderTab} onValueChange={(v) => setOrderTab(v as any)}>
              <TabsList>
                <TabsTrigger value="all">All ({channelOrders.length})</TabsTrigger>
                <TabsTrigger value="ongoing">Ongoing ({ongoingCount})</TabsTrigger>
                <TabsTrigger value="past">Past ({pastCount})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Switch checked={freeMealOnly} onCheckedChange={setFreeMealOnly} />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Gift className="w-3 h-3" /> Free Meal
              </span>
            </div>
          </div>
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
                        <td className="py-3 px-4 font-medium">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {order.order_number}
                            {order.channel === 'whatsapp' && (
                              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-[10px]">💬 WhatsApp</Badge>
                            )}
                            {order.channel === 'assisted' && (
                              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[10px]">🎧 Assisted</Badge>
                            )}
                            {order.is_free_meal && (
                              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-[10px] gap-0.5">
                                <Gift className="w-2.5 h-2.5" /> Free Meal
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div>
                            <div>{order.customer_name}</div>
                            {order.delivery_type !== 'self_pickup' && (
                              <div className="text-[11px] text-muted-foreground line-clamp-2 max-w-[220px] mt-0.5 flex items-start gap-0.5">
                                <span>📍</span>
                                <span>{order.delivery_address_text || '—'}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{order.customer_phone}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span>{order.vendors?.name}</span>
                            {order.vendors?.user_id && !isTerminal(order.status) && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-primary"
                                title="Call vendor as FastCalories"
                                onClick={() => callVendor(order)}
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {order.channel === 'pos' ? (
                            <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 text-xs">🧾 POS</Badge>
                          ) : order.delivery_type === 'self_pickup' ? (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">🏪 Carryout</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">🚚 Delivery</Badge>
                          )}
                         </td>
                        <td className="py-3 px-4">
                          {order.promo_code ? (
                            order.promo_code.startsWith('SPIN-') ? (
                              <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">
                                🎰 Spin {order.discount > 0 ? `₦${Number(order.discount).toLocaleString()} OFF` : 'Wheel'}
                              </Badge>
                            ) : (
                              <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 text-xs font-mono">
                                🏷️ {order.promo_code}
                              </Badge>
                            )
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
                             <div className="flex items-center gap-1.5">
                               <span className="text-sm flex items-center gap-1">
                                 <span className="text-primary">🏍️</span>
                                 {order.rider_name}
                               </span>
                               {order.rider_id && !isTerminal(order.status) && (
                                 <Button
                                   size="icon"
                                   variant="ghost"
                                   className="h-6 w-6 text-primary"
                                   title="Call rider as FastCalories"
                                   onClick={() => callRider(order)}
                                 >
                                   <PhoneCall className="w-3.5 h-3.5" />
                                 </Button>
                               )}
                             </div>
                           ) : (
                             <span className="text-xs text-muted-foreground">—</span>
                           )}
                         </td>
                        <td className="py-3 px-4">
                          <div>
                            <span>₦{Number(order.total).toLocaleString()}</span>
                            {order.is_free_meal && Number(order.free_meal_value) > 0 && (
                              <p className="text-[10px] text-green-600">
                                Free: ₦{Number(order.free_meal_value).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {format(new Date(order.created_at), 'PP')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1 items-center">
                            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setTrackOrder(order)}>
                              <Eye className="w-4 h-4" /> Track
                            </Button>
                            {order.attended_by_staff_id && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30"
                                title={`Attended by ${order.attended_by_name || 'Staff'}${order.attended_by_role ? ` (${String(order.attended_by_role).replace('_',' ')})` : ''}${order.attended_at ? ` at ${format(new Date(order.attended_at), 'p')}` : ''}`}
                              >
                                ✓ {order.attended_by_name || 'Attended'}
                              </span>
                            )}
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
