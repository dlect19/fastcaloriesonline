import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGeoLockCheck } from '@/hooks/useGeoLockCheck';
import { useProfileCompletion } from '@/hooks/useProfileCompletion';
import {
  TrendingUp,
  ShoppingBag,
  Star,
  Wallet,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Package,
  Clock,
  UtensilsCrossed,
  Bike,
  Store,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useToast } from '@/hooks/use-toast';
import { useVendorNotificationSound } from '@/hooks/useVendorNotificationSound';
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner';

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;

export default function VendorDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const { playNotification } = useVendorNotificationSound();
  const { checkGeoLock } = useGeoLockCheck();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [settlementHours, setSettlementHours] = useState<number | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletData, setWalletData] = useState<any>(null);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [settlementInfo, setSettlementInfo] = useState<{ category: string; mode: string; hours: number } | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<{ pending_total: number; next_release_at: string | null; item_count: number } | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<Record<string, any[]>>({});
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const { selectedOutletId, setSelectedOutletId } = usePersistedOutletId();
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    inTransitOrders: 0,
    inTransitRevenue: 0,
    pendingOrders: 0,
    avgRating: 0,
  });

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  const { isComplete: profileComplete, loading: profileLoading } = useProfileCompletion(user?.id);

  // Auto-close/open is now handled globally via VendorSidebar

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user && !profileLoading && !profileComplete) {
      navigate('/profile-setup', { state: { returnTo: '/vendor/dashboard' } });
      return;
    }
    if (user) {
      fetchVendorData();
    }
  }, [user, authLoading, navigate, profileLoading, profileComplete]);

  // Refetch stats when date range or selected outlet changes
  useEffect(() => {
    if (vendor) {
      fetchFilteredStats(vendor);
    }
  }, [dateRange, selectedOutletId]);

  // Refetch orders when outlet changes
  useEffect(() => {
    if (vendor) {
      fetchVendorData();
    }
  }, [selectedOutletId]);

  // Subscribe to vendor status changes (auto-open/close from sidebar hook)
  useEffect(() => {
    if (!vendor) return;

    const channel = supabase
      .channel('vendor-status-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'vendors',
          filter: `id=eq.${vendor.id}`,
        },
        (payload) => {
          const newIsOpen = (payload.new as any)?.is_open;
          if (newIsOpen !== undefined && newIsOpen !== vendor.is_open) {
            setVendor(prev => prev ? { ...prev, is_open: newIsOpen } : prev);
            toast({
              title: newIsOpen ? 'Store auto-opened (working hours)' : 'Store auto-closed (working hours)',
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendor?.id, vendor?.is_open]);

  // Subscribe to real-time order updates for notifications
  useEffect(() => {
    if (!vendor) return;

    const channel = supabase
      .channel('vendor-dashboard-orders')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `vendor_id=eq.${vendor.id}`,
        },
        () => {
          playNotification();
          toast({
            title: '🔔 New Order!',
            description: 'You have a new order to process',
          });
          fetchVendorData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendor, playNotification, toast]);

  const getDateRangeForQuery = () => {
    if (dateRange.from) {
      const start = dateRange.from.toISOString();
      let end: string;
      if (dateRange.to) {
        const endDate = new Date(dateRange.to);
        endDate.setHours(23, 59, 59, 999);
        end = endDate.toISOString();
      } else {
        const endDate = new Date(dateRange.from);
        endDate.setHours(23, 59, 59, 999);
        end = endDate.toISOString();
      }
      return { start, end };
    }
    // Default: today
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    return { start: todayStart, end: tomorrowStart };
  };

  const fetchFilteredStats = async (vendorData: Vendor) => {
    try {
      const { start, end } = getDateRangeForQuery();

      // Fetch DELIVERED paid orders for the date range
      let deliveredQuery = supabase
        .from('orders')
        .select('id, subtotal, menu_subtotal')
        .eq('vendor_id', vendorData.id)
        .eq('payment_status', 'paid')
        .eq('status', 'delivered')
        .gte('created_at', start)
        .lt('created_at', end);
      if (selectedOutletId) deliveredQuery = deliveredQuery.eq('outlet_id', selectedOutletId);
      const { data: deliveredOrders } = await deliveredQuery;

      // Fetch IN-TRANSIT paid orders for the date range
      let inTransitQuery = supabase
        .from('orders')
        .select('id, subtotal, menu_subtotal')
        .eq('vendor_id', vendorData.id)
        .eq('payment_status', 'paid')
        .in('status', ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'])
        .gte('created_at', start)
        .lt('created_at', end);
      if (selectedOutletId) inTransitQuery = inTransitQuery.eq('outlet_id', selectedOutletId);
      const { data: inTransitOrders } = await inTransitQuery;

      const revenue = (deliveredOrders || []).reduce(
        (sum, o) => sum + Number(o.subtotal || 0), 0
      );
      const inTransitRevenue = (inTransitOrders || []).reduce(
        (sum, o) => sum + Number(o.subtotal || 0), 0
      );

      setStats(prev => ({
        ...prev,
        todayOrders: deliveredOrders?.length || 0,
        todayRevenue: revenue,
        inTransitOrders: inTransitOrders?.length || 0,
        inTransitRevenue: inTransitRevenue,
      }));
    } catch (error) {
      console.error('Error fetching filtered stats:', error);
    }
  };

  const fetchVendorData = async () => {
    try {
      // First check if user is a vendor owner
      let vendorData = null;
      const { data: ownedVendor } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (ownedVendor?.[0]) {
        vendorData = ownedVendor[0];
      } else {
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user?.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          const { data: staffVendor } = await supabase
            .from('vendors')
            .select('*')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }
      
      setVendor(vendorData);

      // Fetch settlement hours based on vendor category
      if (vendorData?.category) {
        const categoryKey = `settlement_hours_${(vendorData.category as string).toLowerCase()}`;
        const { data: settlementData } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', categoryKey)
          .maybeSingle();
        setSettlementHours(settlementData ? parseInt(settlementData.value) : null);
      }

      if (vendorData) {
        // Fetch recent orders for display (limit 5)
        let recentQuery = supabase
          .from('orders')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .order('created_at', { ascending: false })
          .limit(5);
        if (selectedOutletId) recentQuery = recentQuery.eq('outlet_id', selectedOutletId);
        const { data: ordersData } = await recentQuery;

        setOrders(ordersData || []);

        // Count pending orders (all, not just recent 5)
        let pendingQuery = supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('vendor_id', vendorData.id)
          .in('status', ['pending', 'confirmed', 'preparing']);
        if (selectedOutletId) pendingQuery = pendingQuery.eq('outlet_id', selectedOutletId);
        const { count: pendingCount } = await pendingQuery;

        // Fetch vendor wallet for revenue pools
        let walletQuery = supabase
          .from('wallets')
          .select('*')
          .eq('user_id', vendorData.user_id)
          .eq('wallet_type', 'vendor');
        if (selectedOutletId) {
          walletQuery = walletQuery.eq('outlet_id', selectedOutletId);
        } else {
          walletQuery = walletQuery.is('outlet_id', null);
        }
        const { data: wallet } = await walletQuery.maybeSingle();
        
        setWalletData(wallet);

        // Fetch ALL wallet transactions for ledger-based balance computation
        if (wallet) {
          const env = isTestMode ? 'development' : 'production';
          const { data: allTxData } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('wallet_id', wallet.id)
            .eq('environment', env);
          if (allTxData) setAllTransactions(allTxData);

          // Fetch settlement period config + currently-held funds
          const [{ data: infoRows }, { data: pendingRows }] = await Promise.all([
            supabase.rpc('get_vendor_settlement_info', { p_wallet_id: wallet.id }),
            supabase.rpc('get_vendor_pending_settlement', { p_wallet_id: wallet.id, p_environment: env }),
          ]);
          if (infoRows && infoRows[0]) setSettlementInfo(infoRows[0] as any);
          if (pendingRows && pendingRows[0]) setPendingSettlement(pendingRows[0] as any);
        }
        setStats(prev => ({
          ...prev,
          pendingOrders: pendingCount || 0,
          avgRating: vendorData.rating || 0,
        }));

        // Fetch date-range-filtered stats
        await fetchFilteredStats(vendorData);
      }
    } catch (error) {
      console.error('Error fetching vendor data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString()}`;
  };

  // Ledger-based balance computation (source of truth)
  const computedMenuBalance = Math.max(0, allTransactions.reduce((sum: number, tx: any) => {
    if (tx.category === 'vendor_share' && tx.status === 'completed') {
      return tx.transaction_type === 'credit' ? sum + Number(tx.amount) : sum - Number(tx.amount);
    }
    if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && tx.notes?.includes('Menu Earnings')) {
      return sum - Number(tx.amount);
    }
    if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && tx.notes?.includes('Menu Earnings')) {
      return sum + Number(tx.amount);
    }
    return sum;
  }, 0));

  const computedMenuPending = Math.max(0, allTransactions
    .filter((tx: any) => tx.category === 'vendor_share' && tx.transaction_type === 'credit' && tx.status === 'pending')
    .reduce((sum: number, tx: any) => sum + Number(tx.amount), 0));

  const computedRiderBalance = Math.max(0, allTransactions.reduce((sum: number, tx: any) => {
    if (tx.category === 'vendor_rider_share' && tx.status === 'completed') {
      return tx.transaction_type === 'credit' ? sum + Number(tx.amount) : sum - Number(tx.amount);
    }
    if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && tx.notes?.includes('Rider Revenue')) {
      return sum - Number(tx.amount);
    }
    if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && tx.notes?.includes('Rider Revenue')) {
      return sum + Number(tx.amount);
    }
    return sum;
  }, 0));

  const toggleOrderExpand = async (orderId: string) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }
    setExpandedOrderId(orderId);
    if (!orderItems[orderId]) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*, order_item_addons(*)')
        .eq('order_id', orderId);
      if (items) {
        setOrderItems(prev => ({ ...prev, [orderId]: items }));
      }
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-warning/10 text-warning',
      confirmed: 'bg-info/10 text-info',
      preparing: 'bg-primary/10 text-primary',
      ready_for_pickup: 'bg-accent/10 text-accent',
      delivered: 'bg-success/10 text-success',
      cancelled: 'bg-destructive/10 text-destructive',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const getDateLabel = () => {
    if (dateRange.from) return 'Filtered';
    return "Today's";
  };

  if (authLoading || loading || permLoading) {
    return (
      <VendorLayout onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </VendorLayout>
    );
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">No Vendor Profile</h1>
          <p className="text-muted-foreground mb-4">You don't have a vendor profile yet.</p>
          <Button onClick={() => navigate('/vendor/auth')}>Register as Vendor</Button>
        </div>
      </div>
    );
  }

  if (!hasPermission('view_dashboard')) {
    return (
      <VendorLayout vendorName={vendor.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <AccessDenied />
      </VendorLayout>
    );
  }

  return (
    <VendorLayout vendorName={vendor.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
      <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
              <p className="text-muted-foreground">Welcome back, {vendor.name}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Store Open/Close Toggle */}
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border">
                <Store className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{vendor.is_open ? 'Open' : 'Closed'}</span>
                <Switch
                  checked={vendor.is_open ?? true}
                  onCheckedChange={async (checked) => {
                    if (checked) {
                      // Geo-lock check on outlet level
                      if (selectedOutletId) {
                        try {
                          const result = await checkGeoLock(selectedOutletId, 'store_open_check');
                          if (!result.passed) {
                            fetchVendorData();
                            return;
                          }
                        } catch {
                          // GPS unavailable, allow open
                        }
                      }
                    }
                    const { error } = await supabase
                      .from('vendors')
                      .update({ is_open: checked })
                      .eq('id', vendor.id);
                    if (!error) {
                      setVendor({ ...vendor, is_open: checked });
                      toast({ title: checked ? 'Store is now open' : 'Store is now closed' });
                    }
                  }}
                />
              </div>
              {!vendor.is_active && (
                <Badge variant="outline" className="w-fit bg-warning/10 text-warning border-warning">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Pending Approval
                </Badge>
              )}
            </div>
          </div>

          {/* Geo-Lock Banner */}

          {/* Push Notification Banner */}
          <PushNotificationBanner />

          {/* Date Range Filter */}
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Delivered {getDateLabel() === "Today's" ? 'Today' : ''}</p>
                    <p className="text-3xl font-bold text-foreground">{stats.todayOrders}</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <ShoppingBag className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{getDateLabel()} Revenue</p>
                    <p className="text-3xl font-bold text-foreground">
                      {hasPermission('view_earnings') ? formatCurrency(stats.todayRevenue) : '***'}
                    </p>
                    <p className="text-xs text-success mt-1">Completed deliveries</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft border-l-4 border-l-warning">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Under Delivery</p>
                    <p className="text-3xl font-bold text-foreground">
                      {hasPermission('view_earnings') ? formatCurrency(stats.inTransitRevenue) : '***'}
                    </p>
                    <p className="text-xs text-warning mt-1">{stats.inTransitOrders} order{stats.inTransitOrders !== 1 ? 's' : ''} in transit</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                    <Bike className="w-6 h-6 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Orders</p>
                    <p className="text-3xl font-bold text-foreground">{stats.pendingOrders}</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                    <Package className="w-6 h-6 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Average Rating</p>
                    <p className="text-3xl font-bold text-foreground">
                      {stats.avgRating.toFixed(1)}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Star className="w-6 h-6 text-accent fill-accent" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Pools - Menu & Rider Revenue */}
          {hasPermission('view_earnings') && walletData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-soft">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                      <UtensilsCrossed className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Menu Sales Revenue</p>
                      <p className="text-xs text-muted-foreground">Earnings from food orders</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="text-xl font-bold text-success">
                        {formatCurrency(computedMenuBalance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pending ({settlementHours === 0 ? 'Immediate' : `${settlementHours || 24}hr hold`})</p>
                      <p className="text-xl font-bold text-warning">
                        {formatCurrency(computedMenuPending)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-soft">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Bike className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Rider Delivery Revenue</p>
                      <p className="text-xs text-muted-foreground">Earnings from affiliated riders</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="text-xl font-bold text-primary">
                        {formatCurrency(computedRiderBalance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">No Hold Period</p>
                      <p className="text-sm text-muted-foreground">Available immediately</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Recent Orders */}
          <Card className="border-0 shadow-soft">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Recent Orders</CardTitle>
              {hasPermission('process_orders') && (
                <Button variant="ghost" size="sm" onClick={() => navigate('/vendor/orders')}>
                  View all
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No orders yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => (
                    <div key={order.id} className="rounded-xl bg-muted/50 overflow-hidden">
                      <div
                        className="flex items-center justify-between p-4 hover:bg-muted transition-colors cursor-pointer"
                        onClick={() => toggleOrderExpand(order.id)}
                      >
                        <div>
                          <p className="font-medium text-foreground">{order.order_number}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(order.created_at).toLocaleString('en-NG', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <div>
                            <p className="font-semibold text-foreground">
                              {hasPermission('view_earnings') ? formatCurrency(Number(order.subtotal)) : '***'}
                            </p>
                            <Badge className={`${getStatusColor(order.status)} border-0 text-xs`}>
                              {order.status.replace('_', ' ')}
                            </Badge>
                          </div>
                          {expandedOrderId === order.id 
                            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          }
                        </div>
                      </div>
                      {expandedOrderId === order.id && (
                        <div className="px-4 pb-4 border-t border-border">
                          {orderItems[order.id] ? (
                            <div className="pt-3 space-y-2">
                              {orderItems[order.id].map((item: any) => (
                                <div key={item.id} className="flex justify-between items-start text-sm">
                                  <div>
                                    <p className="text-foreground">{item.quantity}x {item.product_name}</p>
                                    {item.special_instructions && (
                                      <p className="text-xs text-muted-foreground italic">Note: {item.special_instructions}</p>
                                    )}
                                    {item.order_item_addons?.length > 0 && (
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        {item.order_item_addons.map((addon: any) => (
                                          <span key={addon.id} className="mr-2">+ {addon.addon_item_name}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-foreground font-medium whitespace-nowrap ml-3">
                                    {formatCurrency(Number(item.total_price))}
                                  </p>
                                </div>
                              ))}
                              {order.delivery_type && (
                                <p className="text-xs text-muted-foreground pt-1 border-t border-border mt-2">
                                  Type: {order.delivery_type === 'pickup' ? 'Carryout' : 'Delivery'}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="pt-3 text-sm text-muted-foreground">Loading items...</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {hasPermission('manage_menu') && (
              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-start gap-2"
                onClick={() => navigate('/vendor/menu')}
              >
                <UtensilsCrossed className="w-6 h-6 text-primary" />
                <div className="text-left">
                  <p className="font-semibold">Manage Menu</p>
                  <p className="text-sm text-muted-foreground">Add or edit products</p>
                </div>
              </Button>
            )}

            {hasPermission('edit_settings') && (
              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-start gap-2"
                onClick={() => navigate('/vendor/hours')}
              >
                <Clock className="w-6 h-6 text-primary" />
                <div className="text-left">
                  <p className="font-semibold">Working Hours</p>
                  <p className="text-sm text-muted-foreground">Set your availability</p>
                </div>
              </Button>
            )}

            {hasPermission('view_earnings') && (
              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-start gap-2"
                onClick={() => navigate('/vendor/earnings')}
              >
                <Wallet className="w-6 h-6 text-primary" />
                <div className="text-left">
                  <p className="font-semibold">View Earnings</p>
                  <p className="text-sm text-muted-foreground">Track your revenue</p>
                </div>
              </Button>
            )}
          </div>
      </div>
    </VendorLayout>
  );
}
