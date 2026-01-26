import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  ShoppingBag,
  Star,
  Wallet,
  AlertCircle,
  ChevronRight,
  Package,
  Clock,
  UtensilsCrossed,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useToast } from '@/hooks/use-toast';
import { useVendorNotificationSound } from '@/hooks/useVendorNotificationSound';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;

export default function VendorDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { playNotification } = useVendorNotificationSound();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    pendingOrders: 0,
    avgRating: 0,
  });

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchVendorData();
    }
  }, [user, authLoading, navigate]);

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
          // Play notification sound for new orders
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
        // Check if user is staff of any vendor
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

      if (vendorData) {
        // Fetch recent orders
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .order('created_at', { ascending: false })
          .limit(5);

        setOrders(ordersData || []);

        // Calculate stats
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = ordersData?.filter(
          (o) => o.created_at.startsWith(today)
        ) || [];
        const pendingOrders = ordersData?.filter(
          (o) => ['pending', 'confirmed', 'preparing'].includes(o.status)
        ) || [];

        setStats({
          todayOrders: todayOrders.length,
          todayRevenue: todayOrders.reduce((sum, o) => sum + Number(o.subtotal), 0),
          pendingOrders: pendingOrders.length,
          avgRating: vendorData.rating || 0,
        });
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

  if (authLoading || loading || permLoading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
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
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor.name} permissions={permissions} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor.name} permissions={permissions} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
              <p className="text-muted-foreground">Welcome back, {vendor.name}</p>
            </div>
            {!vendor.is_active && (
              <Badge variant="outline" className="w-fit bg-warning/10 text-warning border-warning">
                <AlertCircle className="w-3 h-3 mr-1" />
                Pending Approval
              </Badge>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Today's Orders</p>
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
                    <p className="text-sm text-muted-foreground">Today's Revenue</p>
                    <p className="text-3xl font-bold text-foreground">
                      {hasPermission('view_earnings') ? formatCurrency(stats.todayRevenue) : '***'}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-success" />
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
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
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
                            {hasPermission('view_earnings') ? formatCurrency(Number(order.total)) : '***'}
                          </p>
                          <Badge className={`${getStatusColor(order.status)} border-0 text-xs`}>
                            {order.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions - Only show actions user has permission for */}
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
      </main>
    </div>
  );
}
