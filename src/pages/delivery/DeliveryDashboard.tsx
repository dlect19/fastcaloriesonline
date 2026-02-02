import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Users, Wallet, TrendingUp, Clock, CheckCircle2, AlertTriangle, Truck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { supabase } from '@/integrations/supabase/client';

interface DashboardStats {
  totalDeliveries: number;
  activeDeliveries: number;
  completedToday: number;
  totalRiders: number;
  onlineRiders: number;
  walletBalance: number;
  pendingBalance: number;
  todayEarnings: number;
}

export default function DeliveryDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { company, loading: companyLoading, isVerified } = useDeliveryCompany();
  const { isTestMode } = useEnvironmentConfig();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      fetchDashboardData();
    }
  }, [user, authLoading, company, navigate]);

  const fetchDashboardData = async () => {
    if (!company) return;

    try {
      // Get riders belonging to this company
      const { data: companyRiders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, is_online, is_verified')
        .eq('delivery_company_id', company.id);

      const riderUserIds = companyRiders?.map(r => r.user_id) || [];
      const onlineRiders = companyRiders?.filter(r => r.is_online).length || 0;

      // Get orders delivered by company riders
      let totalDeliveries = 0;
      let completedToday = 0;
      let activeDeliveries = 0;

      if (riderUserIds.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: orders, count } = await supabase
          .from('orders')
          .select('*', { count: 'exact' })
          .in('rider_id', riderUserIds);

        totalDeliveries = count || 0;

        const { data: todayOrders } = await supabase
          .from('orders')
          .select('*')
          .in('rider_id', riderUserIds)
          .eq('status', 'delivered')
          .gte('delivered_at', today.toISOString());

        completedToday = todayOrders?.length || 0;

        const { data: activeOrders } = await supabase
          .from('orders')
          .select('*')
          .in('rider_id', riderUserIds)
          .not('status', 'in', '("delivered","cancelled")');

        activeDeliveries = activeOrders?.length || 0;

        // Get recent orders for display
        const { data: recent } = await supabase
          .from('orders')
          .select('*, vendors(name)')
          .in('rider_id', riderUserIds)
          .order('created_at', { ascending: false })
          .limit(5);

        setRecentOrders(recent || []);
      }

      // Get wallet balance
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', company.user_id)
        .eq('wallet_type', 'delivery_company')
        .maybeSingle();

      const walletBalance = isTestMode
        ? Number(walletData?.test_balance) || 0
        : Number(walletData?.balance) || 0;

      // Get today's earnings from transactions
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let todayEarnings = 0;
      if (walletData) {
        const { data: todayTx } = await supabase
          .from('wallet_transactions')
          .select('amount')
          .eq('wallet_id', walletData.id)
          .eq('category', 'delivery_company_share')
          .gte('created_at', today.toISOString());

        todayEarnings = todayTx?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      }

      setStats({
        totalDeliveries,
        activeDeliveries,
        completedToday,
        totalRiders: companyRiders?.length || 0,
        onlineRiders,
        walletBalance,
        pendingBalance: 0,
        todayEarnings,
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      confirmed: { variant: 'secondary', label: 'Confirmed' },
      preparing: { variant: 'secondary', label: 'Preparing' },
      ready_for_pickup: { variant: 'outline', label: 'Ready' },
      picked_up: { variant: 'default', label: 'Picked Up' },
      on_the_way: { variant: 'default', label: 'On The Way' },
      delivered: { variant: 'default', label: 'Delivered' },
      cancelled: { variant: 'destructive', label: 'Cancelled' },
    };
    const config = variants[status] || { variant: 'secondary', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (authLoading || companyLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
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

  if (!company) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Truck className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">No Company Found</h2>
                <p className="text-muted-foreground text-center">
                  Please register your delivery company to access the dashboard.
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DeliverySidebar companyName={company.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back, {company.name}</p>
          </div>

          {/* Verification Warning */}
          {!isVerified && (
            <Card className="border-warning bg-warning/10">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <div>
                  <p className="font-medium text-warning">Company Pending Verification</p>
                  <p className="text-sm text-muted-foreground">
                    Your company is being reviewed by our team. You can still manage riders, but deliveries won't be assigned until verification is complete.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Deliveries</p>
                    <p className="text-2xl font-bold">{stats?.totalDeliveries || 0}</p>
                  </div>
                  <Package className="w-8 h-8 text-primary" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Now</p>
                    <p className="text-2xl font-bold">{stats?.activeDeliveries || 0}</p>
                  </div>
                  <Clock className="w-8 h-8 text-warning" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Riders</p>
                    <p className="text-2xl font-bold">
                      {stats?.onlineRiders || 0}
                      <span className="text-sm text-muted-foreground font-normal">
                        /{stats?.totalRiders || 0}
                      </span>
                    </p>
                  </div>
                  <Users className="w-8 h-8 text-success" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Available Balance</p>
                    <p className="text-2xl font-bold">{formatCurrency(stats?.walletBalance || 0)}</p>
                  </div>
                  <Wallet className="w-8 h-8 text-accent" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Completed Today</p>
                    <p className="text-3xl font-bold text-success">{stats?.completedToday || 0}</p>
                  </div>
                  <CheckCircle2 className="w-10 h-10 text-success/30" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Today's Earnings</p>
                    <p className="text-3xl font-bold text-primary">{formatCurrency(stats?.todayEarnings || 0)}</p>
                  </div>
                  <TrendingUp className="w-10 h-10 text-primary/30" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Orders */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Deliveries</CardTitle>
              <CardDescription>Latest orders assigned to your riders</CardDescription>
            </CardHeader>
            <CardContent>
              {recentOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No deliveries yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">#{order.order_number}</p>
                        <p className="text-sm text-muted-foreground">{order.vendors?.name}</p>
                      </div>
                      <div className="text-right">
                        {getStatusBadge(order.status)}
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatCurrency(Number(order.delivery_fee) || 0)} fee
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
