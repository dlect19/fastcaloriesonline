import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { PromoImpactCard } from '@/components/admin/PromoImpactCard';
import { CompanyProfitCard } from '@/components/admin/CompanyProfitCard';
import { FinancialResetDialog } from '@/components/admin/FinancialResetDialog';
import { FinancialPerformanceChart } from '@/components/admin/FinancialPerformanceChart';
import { AdminRiderBreakdown } from '@/components/admin/AdminRiderBreakdown';
import { AdminBalanceBreakdown } from '@/components/admin/AdminBalanceBreakdown';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, Store, Bike, Users, DollarSign, TrendingUp, Loader2, Wallet, ArrowDownToLine, ArrowUpFromLine, PiggyBank, Percent, Receipt, Truck, CreditCard, FlaskConical, Globe } from 'lucide-react';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface FinancialStats {
  grossRevenue: number;
  platformCommission: number;
  deliveryRevenue: number;
  serviceFees: number;
  totalPayouts: number;
  pendingPayouts: number;
  vendorBalances: number;
  riderBalances: number;
  deliveryCompanyBalances: number;
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

interface VendorBreakdown {
  vendorId: string;
  vendorName: string;
  totalOrders: number;
  grossRevenue: number;
  commission: number;
  netPayout: number;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { effectiveEnvironment, isTestMode, loading: envLoading } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
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
    deliveryCompanyBalances: 0,
    platformBalance: 0,
    totalEarned: 0,
  });
  const [vendorBreakdowns, setVendorBreakdowns] = useState<VendorBreakdown[]>([]);
  const [riderSharePct, setRiderSharePct] = useState(80);

  useEffect(() => {
    checkAuth();
  }, []);

  // Refetch data when environment changes
  useEffect(() => {
    if (!envLoading && effectiveEnvironment) {
      fetchStats();
      fetchFinancialStats();
    }
  }, [effectiveEnvironment, envLoading]);

  // Refetch when date range changes
  useEffect(() => {
    if (!envLoading && effectiveEnvironment) {
      fetchFinancialStats();
    }
  }, [dateRange]);

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
 
  const handleResetComplete = () => {
    fetchStats();
    fetchFinancialStats();
  };

  const fetchStats = async () => {
    try {
      const envFilter = isTestMode ? 'development' : 'production';
      
      const [ordersRes, vendorsRes, ridersRes, usersRes, pendingVendorsRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact' }).eq('environment', envFilter),
        supabase.from('vendors').select('id', { count: 'exact' }).eq('is_verified', true).eq('is_test_store', isTestMode),
        supabase.from('rider_profiles').select('id', { count: 'exact' }).eq('is_verified', true).eq('is_test_rider', isTestMode),
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
      const envFilter = isTestMode ? 'development' : 'production';
      
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
        .select('balance, test_balance, total_earned, total_paid_out')
        .maybeSingle();

      // Fetch orders filtered by environment and date range
      let orderQuery = supabase
        .from('orders')
        .select('total, subtotal, delivery_fee, service_fee, vendor_id')
        .eq('environment', envFilter)
        .eq('payment_status', 'paid')
        .not('status', 'eq', 'cancelled');

      if (dateRange.from) {
        orderQuery = orderQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endDate = new Date(dateRange.to);
        endDate.setHours(23, 59, 59, 999);
        orderQuery = orderQuery.lte('created_at', endDate.toISOString());
      }

      const { data: orders } = await orderQuery;

      // Fetch vendor commission rates and names
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name, commission_rate');

      // Fetch payout requests with date filter
      let payoutQuery = supabase
        .from('payout_requests')
        .select('amount, status, created_at')
        .eq('environment', envFilter);

      if (dateRange.from) {
        payoutQuery = payoutQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endDate2 = new Date(dateRange.to);
        endDate2.setHours(23, 59, 59, 999);
        payoutQuery = payoutQuery.lte('created_at', endDate2.toISOString());
      }

      const { data: payouts } = await payoutQuery;

      // Fetch wallet balances
      const { data: wallets } = await supabase
        .from('wallets')
        .select('wallet_type, eligible_balance, pending_balance, test_eligible_balance, test_pending_balance');

      // Calculate financial metrics
      let grossRevenue = 0;
      let platformCommission = 0;
      let deliveryRevenue = 0;
      let serviceFees = 0;

      // Per-vendor breakdown map
      const vendorMap = new Map<string, VendorBreakdown>();

      orders?.forEach(order => {
        grossRevenue += Number(order.total) || 0;
        serviceFees += Number(order.service_fee) || 0;
        
        const vendor = vendors?.find(v => v.id === order.vendor_id);
        const commissionRate = vendor?.commission_rate || 15;
        const orderSubtotal = Number(order.subtotal) || 0;
        const commission = orderSubtotal * (commissionRate / 100);
        platformCommission += commission;
        
        const deliveryFee = Number(order.delivery_fee) || 0;
        deliveryRevenue += deliveryFee * ((100 - riderSharePercent) / 100);

        // Build per-vendor breakdown
        if (order.vendor_id) {
          const existing = vendorMap.get(order.vendor_id);
          if (existing) {
            existing.totalOrders += 1;
            existing.grossRevenue += orderSubtotal;
            existing.commission += commission;
            existing.netPayout += orderSubtotal - commission;
          } else {
            vendorMap.set(order.vendor_id, {
              vendorId: order.vendor_id,
              vendorName: vendor?.name || 'Unknown Vendor',
              totalOrders: 1,
              grossRevenue: orderSubtotal,
              commission: commission,
              netPayout: orderSubtotal - commission,
            });
          }
        }
      });

      // Sort vendor breakdowns by gross revenue descending
      const breakdowns = Array.from(vendorMap.values()).sort((a, b) => b.grossRevenue - a.grossRevenue);
      setVendorBreakdowns(breakdowns);

      // Calculate payout totals
      const totalPayouts = payouts?.filter(p => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      const pendingPayouts = payouts?.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      // Calculate wallet balances by type
      const balanceField = isTestMode ? 'test_eligible_balance' : 'eligible_balance';
      const vendorBalances = wallets?.filter(w => w.wallet_type === 'vendor').reduce((sum, w) => sum + (Number(w[balanceField]) || 0), 0) || 0;
      const riderBalances = wallets?.filter(w => w.wallet_type === 'rider').reduce((sum, w) => sum + (Number(w[balanceField]) || 0), 0) || 0;
      const deliveryCompanyBalances = wallets?.filter(w => w.wallet_type === 'delivery_company').reduce((sum, w) => sum + (Number(w[balanceField]) || 0), 0) || 0;

      const platformBalance = isTestMode 
        ? Number(platformWallet?.test_balance) || 0 
        : Number(platformWallet?.balance) || 0;

      setFinancialStats({
        grossRevenue,
        platformCommission,
        deliveryRevenue,
        serviceFees,
        totalPayouts,
        pendingPayouts,
        vendorBalances,
        riderBalances,
        deliveryCompanyBalances,
        platformBalance,
        totalEarned: isTestMode ? platformBalance : Number(platformWallet?.total_earned) || 0,
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
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
            <Badge 
              variant="outline" 
              className={isTestMode 
                ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" 
                : "bg-green-500/10 text-green-600 border-green-500/30"
              }
            >
              {isTestMode ? (
                <>
                  <FlaskConical className="w-3 h-3 mr-1" />
                  Development Mode
                </>
              ) : (
                <>
                  <Globe className="w-3 h-3 mr-1" />
                  Production Mode
                </>
              )}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Financial overview and platform management
            {isTestMode && " • Showing test data only"}
          </p>
        </div>

        {/* Date Range Filter */}
        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

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

        {/* Breakdowns by Tab */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Performance Breakdowns</h2>
          <Tabs defaultValue="vendors" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="vendors" className="gap-2">
                <Store className="w-4 h-4" />
                Vendors
              </TabsTrigger>
              <TabsTrigger value="riders" className="gap-2">
                <Bike className="w-4 h-4" />
                Riders
              </TabsTrigger>
              <TabsTrigger value="logistics" className="gap-2">
                <Truck className="w-4 h-4" />
                Logistics Riders
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vendors">
              {vendorBreakdowns.length > 0 ? (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Gross Revenue</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead className="text-right">Net Payout</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vendorBreakdowns.map((v) => (
                          <TableRow key={v.vendorId}>
                            <TableCell className="font-medium">{v.vendorName}</TableCell>
                            <TableCell className="text-right">{v.totalOrders}</TableCell>
                            <TableCell className="text-right">{formatCurrency(v.grossRevenue)}</TableCell>
                            <TableCell className="text-right text-calorie-low">{formatCurrency(v.commission)}</TableCell>
                            <TableCell className="text-right text-success">{formatCurrency(v.netPayout)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-bold border-t-2">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{vendorBreakdowns.reduce((s, v) => s + v.totalOrders, 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(vendorBreakdowns.reduce((s, v) => s + v.grossRevenue, 0))}</TableCell>
                          <TableCell className="text-right text-calorie-low">{formatCurrency(vendorBreakdowns.reduce((s, v) => s + v.commission, 0))}</TableCell>
                          <TableCell className="text-right text-success">{formatCurrency(vendorBreakdowns.reduce((s, v) => s + v.netPayout, 0))}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Store className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No vendor data for this period</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="riders">
              <AdminRiderBreakdown 
                environment={isTestMode ? 'development' : 'production'} 
                dateRange={dateRange}
                type="platform"
              />
            </TabsContent>

            <TabsContent value="logistics">
              <AdminRiderBreakdown 
                environment={isTestMode ? 'development' : 'production'} 
                dateRange={dateRange}
                type="logistics"
              />
            </TabsContent>
          </Tabs>
        </section>

        {/* Payouts & Balances */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Payouts & Balances</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Logistics Balances</CardTitle>
                <Truck className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(financialStats.deliveryCompanyBalances)}</div>
                <p className="text-xs text-muted-foreground">Eligible for withdrawal</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Individual Balance Breakdown */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Individual Withdrawable Balances</h2>
          <AdminBalanceBreakdown isTestMode={isTestMode} />
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

        {/* Company Profit & Loss */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Company Profit & Loss</h2>
          <CompanyProfitCard environment={isTestMode ? 'development' : 'production'} />
        </section>

        {/* Financial Performance Chart */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Financial Performance</h2>
          <FinancialPerformanceChart environment={isTestMode ? 'development' : 'production'} />
        </section>

        {/* Promo Impact Analysis */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Promo Impact Analysis</h2>
          <PromoImpactCard environment={isTestMode ? 'development' : 'production'} days={30} />
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
           <FinancialResetDialog onResetComplete={handleResetComplete} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
