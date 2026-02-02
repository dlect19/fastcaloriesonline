import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { PromoImpactCard } from '@/components/admin/PromoImpactCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Package, Store, Bike, Users, DollarSign, TrendingUp, Loader2, Wallet, ArrowDownToLine, ArrowUpFromLine, PiggyBank, Percent, Receipt, Truck, CreditCard } from 'lucide-react';

interface FinancialStats {
  grossRevenue: number;
  platformCommission: number;
  deliveryRevenue: number;
  serviceFees: number;
  totalPayouts: number;
  pendingPayouts: number;
  vendorBalances: number;
  riderBalances: number;
  platformBalance: number;
  totalEarned: number;
}

interface PlatformStats {
  totalOrders: number;
  totalVendors: number;
  totalRiders: number;
  totalUsers: number;
  pendingVendors: number;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlatformStats>({
    totalOrders: 0,
    totalVendors: 0,
    totalRiders: 0,
    totalUsers: 0,
    pendingVendors: 0,
  });
  const [financialStats, setFinancialStats] = useState<FinancialStats>({
    grossRevenue: 0,
    platformCommission: 0,
    deliveryRevenue: 0,
    serviceFees: 0,
    totalPayouts: 0,
    pendingPayouts: 0,
    vendorBalances: 0,
    riderBalances: 0,
    platformBalance: 0,
    totalEarned: 0,
  });
  const [riderSharePct, setRiderSharePct] = useState(80);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
      return;
    }

    await Promise.all([fetchStats(), fetchFinancialStats()]);
  };

  const fetchStats = async () => {
    try {
      const [ordersRes, vendorsRes, ridersRes, usersRes, pendingVendorsRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact' }),
        supabase.from('vendors').select('id', { count: 'exact' }).eq('is_verified', true),
        supabase.from('rider_profiles').select('id', { count: 'exact' }).eq('is_verified', true),
        supabase.from('profiles').select('id', { count: 'exact' }),
        supabase.from('vendors').select('id', { count: 'exact' }).eq('is_verified', false),
      ]);

      setStats({
        totalOrders: ordersRes.count || 0,
        totalVendors: vendorsRes.count || 0,
        totalRiders: ridersRes.count || 0,
        totalUsers: usersRes.count || 0,
        pendingVendors: pendingVendorsRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchFinancialStats = async () => {
    try {
      // Fetch rider share percentage from settings
      const { data: settings } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['default_rider_share_percentage']);
      
      const riderShare = settings?.find(s => s.key === 'default_rider_share_percentage');
      const riderSharePercent = riderShare ? parseFloat(riderShare.value) : 80;
      setRiderSharePct(riderSharePercent);

      // Fetch platform wallet
      const { data: platformWallet } = await supabase
        .from('platform_wallet')
        .select('balance, total_earned, total_paid_out')
        .maybeSingle();

      // Fetch orders with vendor info for commission calculation
      const { data: orders } = await supabase
        .from('orders')
        .select('total, subtotal, delivery_fee, service_fee, vendor_id');

      // Fetch vendor commission rates
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, commission_rate');

      // Fetch payout requests
      const { data: payouts } = await supabase
        .from('payout_requests')
        .select('amount, status');

      // Fetch wallet balances
      const { data: wallets } = await supabase
        .from('wallets')
        .select('wallet_type, eligible_balance, pending_balance');

      // Calculate financial metrics
      let grossRevenue = 0;
      let platformCommission = 0;
      let deliveryRevenue = 0;
      let serviceFees = 0;

      orders?.forEach(order => {
        grossRevenue += Number(order.total) || 0;
        serviceFees += Number(order.service_fee) || 0;
        
        // Calculate commission for this order
        const vendor = vendors?.find(v => v.id === order.vendor_id);
        const commissionRate = vendor?.commission_rate || 15;
        platformCommission += (Number(order.subtotal) || 0) * (commissionRate / 100);
        
        // Calculate platform's share of delivery fee
        const deliveryFee = Number(order.delivery_fee) || 0;
        deliveryRevenue += deliveryFee * ((100 - riderSharePercent) / 100);
      });

      // Calculate payout totals
      const totalPayouts = payouts?.filter(p => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      const pendingPayouts = payouts?.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      // Calculate wallet balances by type
      const vendorBalances = wallets?.filter(w => w.wallet_type === 'vendor').reduce((sum, w) => sum + (Number(w.eligible_balance) || 0), 0) || 0;
      const riderBalances = wallets?.filter(w => w.wallet_type === 'rider').reduce((sum, w) => sum + (Number(w.eligible_balance) || 0), 0) || 0;

      setFinancialStats({
        grossRevenue,
        platformCommission,
        deliveryRevenue,
        serviceFees,
        totalPayouts,
        pendingPayouts,
        vendorBalances,
        riderBalances,
        platformBalance: Number(platformWallet?.balance) || 0,
        totalEarned: Number(platformWallet?.total_earned) || 0,
      });
    } catch (error) {
      console.error('Error fetching financial stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      
      <main className="flex-1 p-8 space-y-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground">Financial overview and platform management</p>
        </div>

        {/* Platform Overview */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Platform Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
                <Package className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalOrders}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Vendors</CardTitle>
                <Store className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalVendors}</div>
                {stats.pendingVendors > 0 && (
                  <p className="text-xs text-calorie-medium">{stats.pendingVendors} pending approval</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Riders</CardTitle>
                <Bike className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalRiders}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalUsers}</div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Revenue Breakdown */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Revenue Breakdown</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-primary">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gross Revenue</CardTitle>
                <Receipt className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.grossRevenue)}</div>
                <p className="text-xs text-muted-foreground">Total order amounts</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-calorie-low">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Platform Commission</CardTitle>
                <Percent className="w-4 h-4 text-calorie-low" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-calorie-low">{formatCurrency(financialStats.platformCommission)}</div>
                <p className="text-xs text-muted-foreground">Commission from vendors</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-blue-500 dark:border-l-blue-400">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Delivery Revenue</CardTitle>
                <Truck className="w-4 h-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.deliveryRevenue)}</div>
                <p className="text-xs text-muted-foreground">{100 - riderSharePct}% platform share</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500 dark:border-l-purple-400">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Service Fees</CardTitle>
                <CreditCard className="w-4 h-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.serviceFees)}</div>
                <p className="text-xs text-muted-foreground">From all orders</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Payouts & Balances */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Payouts & Balances</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Payouts</CardTitle>
                <ArrowUpFromLine className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.totalPayouts)}</div>
                <p className="text-xs text-muted-foreground">Completed payouts</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payouts</CardTitle>
                <ArrowDownToLine className="w-4 h-4 text-calorie-medium" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-calorie-medium">{formatCurrency(financialStats.pendingPayouts)}</div>
                <p className="text-xs text-muted-foreground">Awaiting processing</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Vendor Balances</CardTitle>
                <Store className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.vendorBalances)}</div>
                <p className="text-xs text-muted-foreground">Eligible for withdrawal</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Rider Balances</CardTitle>
                <Bike className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.riderBalances)}</div>
                <p className="text-xs text-muted-foreground">Eligible for withdrawal</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Platform Financial Position */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Platform Financial Position</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Platform Wallet</CardTitle>
                <Wallet className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">{formatCurrency(financialStats.platformBalance)}</div>
                <p className="text-xs text-muted-foreground">Current balance</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Earned</CardTitle>
                <TrendingUp className="w-4 h-4 text-calorie-low" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrency(financialStats.totalEarned)}</div>
                <p className="text-xs text-muted-foreground">All-time earnings</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Position</CardTitle>
                <PiggyBank className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatCurrency(financialStats.platformBalance - financialStats.pendingPayouts)}
                </div>
                <p className="text-xs text-muted-foreground">Balance - Pending Payouts</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Promo Impact Analysis */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Promo Impact Analysis</h2>
          <PromoImpactCard days={30} />
        </section>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => navigate('/admin/vendors')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Store className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Manage Vendors</p>
            </button>
            <button
              onClick={() => navigate('/admin/riders')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Bike className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Manage Riders</p>
            </button>
            <button
              onClick={() => navigate('/admin/orders')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Package className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">View Orders</p>
            </button>
            <button
              onClick={() => navigate('/admin/promos')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <DollarSign className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Promo Codes</p>
            </button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
