import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownRight, Calendar, Clock, AlertCircle, FlaskConical, Bike, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { EarningsBreakdownCard } from '@/components/shared/EarningsBreakdownCard';
import { EarningsExplanation } from '@/components/shared/EarningsExplanation';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useOrderFinancials } from '@/hooks/useOrderFinancials';
import { supabase } from '@/integrations/supabase/client';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { CommissionDisplay } from '@/components/shared/CommissionDisplay';
interface Vendor {
  id: string;
  name: string;
  commission_rate: number | null;
}

interface VendorWallet {
  id: string;
  balance: number;
  pending_balance: number;
  eligible_balance: number;
  pending_payouts: number;
  total_earned: number;
  total_withdrawn: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  // Separate revenue pools
  menu_earnings_balance: number;
  menu_earnings_pending: number;
  rider_revenue_balance: number;
}

interface WalletTransaction {
  id: string;
  wallet_type: string;
  transaction_type: string;
  category: string;
  amount: number;
  status: string;
  order_id: string | null;
  created_at: string;
  notes: string | null;
  metadata: Record<string, unknown>;
}

export default function VendorEarnings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { isTestMode } = useEnvironmentConfig();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [wallet, setWallet] = useState<VendorWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  const [txPage, setTxPage] = useState(1);
  const TX_PER_PAGE = 10;
  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);
  
  // Fetch order financials for breakdown
  const { data: financialBreakdown, loading: financialsLoading } = useOrderFinancials({
    vendorId: vendor?.id,
    outletId: selectedOutletId,
    environment: isTestMode ? 'development' : 'production',
    dateRange,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user && selectedOutletId !== null) {
      fetchData();
      setTxPage(1);
    }
  }, [user, authLoading, navigate, dateRange, isTestMode, selectedOutletId]);

  const fetchData = async () => {
    try {
      // First check if user is a vendor owner
      let vendorData = null;
      const { data: ownedVendor } = await supabase
        .from('vendors')
        .select('id, name, commission_rate')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ownedVendor) {
        vendorData = ownedVendor;
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
            .select('id, name, commission_rate')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      if (!vendorData) {
        setLoading(false);
        return;
      }

      // Get wallet data - for vendors, wallet should be linked to the vendor owner's user_id
      // Get the vendor owner's user_id
      const { data: vendorFull } = await supabase
        .from('vendors')
        .select('user_id')
        .eq('id', vendorData.id)
        .single();

      const vendorOwnerId = vendorFull?.user_id;

      if (!selectedOutletId) {
        setWallet(null);
        setTransactions([]);
        setAllTransactions([]);
        return;
      }

      // Get or create outlet wallet for vendor
      let { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', vendorOwnerId)
        .eq('wallet_type', 'vendor')
        .eq('outlet_id', selectedOutletId)
        .maybeSingle();

      // Auto-create outlet wallet if it doesn't exist for vendor
      if (!walletData && vendorOwnerId) {
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({
            user_id: vendorOwnerId,
            wallet_type: 'vendor',
            outlet_id: selectedOutletId,
            balance: 0,
            eligible_balance: 0,
            pending_balance: 0,
            total_earned: 0,
            total_withdrawn: 0,
          })
          .select()
          .single();

        if (!createError && newWallet) {
          walletData = newWallet;
        }
      }

      if (walletData) {
        // Use test columns if in test mode, otherwise production columns
        const balance = isTestMode 
          ? Number(walletData.test_balance) || 0 
          : Number(walletData.balance) || 0;
        const pendingBalance = isTestMode 
          ? Number(walletData.test_pending_balance) || 0 
          : Number(walletData.pending_balance) || 0;
        const eligibleBalance = isTestMode 
          ? Number(walletData.test_eligible_balance) || 0 
          : Number(walletData.eligible_balance) || 0;
        const totalEarned = Number(walletData.total_earned) || 0;
        
        // Separate revenue pools
        const menuEarningsBalance = isTestMode
          ? Number(walletData.test_menu_earnings_balance) || 0
          : Number(walletData.menu_earnings_balance) || 0;
        const menuEarningsPending = isTestMode
          ? Number(walletData.test_menu_earnings_pending) || 0
          : Number(walletData.menu_earnings_pending) || 0;
        const riderRevenueBalance = isTestMode
          ? Number(walletData.test_rider_revenue_balance) || 0
          : Number(walletData.rider_revenue_balance) || 0;

        setWallet({
          id: walletData.id,
          balance: balance,
          pending_balance: pendingBalance,
          eligible_balance: eligibleBalance,
          pending_payouts: Number(walletData.pending_payouts) || 0,
          total_earned: totalEarned,
          total_withdrawn: Number(walletData.total_withdrawn) || 0,
          bank_name: walletData.bank_name,
          bank_account_number: walletData.bank_account_number,
          bank_account_name: walletData.bank_account_name,
          menu_earnings_balance: menuEarningsBalance,
          menu_earnings_pending: menuEarningsPending,
          rider_revenue_balance: riderRevenueBalance,
        });

        // Get recent transactions - filter by environment in test mode and date range
        let txQuery = supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(100);

        // Apply date range filter
        if (dateRange.from) {
          txQuery = txQuery.gte('created_at', dateRange.from.toISOString());
        }
        if (dateRange.to) {
          const endOfToDate = new Date(dateRange.to);
          endOfToDate.setHours(23, 59, 59, 999);
          txQuery = txQuery.lte('created_at', endOfToDate.toISOString());
        }

        const { data: txData } = await txQuery;

          const mapTx = (tx: any): WalletTransaction => ({
            id: tx.id,
            wallet_type: tx.wallet_type,
            transaction_type: tx.transaction_type,
            category: tx.category,
            amount: Number(tx.amount),
            status: tx.status || 'completed',
            order_id: tx.order_id,
            created_at: tx.created_at,
            notes: tx.notes || null,
            metadata: (tx.metadata as Record<string, unknown>) || {},
          });

          if (txData) {
            setTransactions(txData.map(mapTx));
          }

          // Fetch ALL transactions (no date filter) for accurate balance computation
          const env = isTestMode ? 'development' : 'production';
          const { data: allTxData } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('wallet_id', walletData.id)
            .eq('environment', env);

          if (allTxData) {
            setAllTransactions(allTxData.map(mapTx));
          }
        }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      vendor_share: 'Order Earnings',
      vendor_rider_share: 'Rider Delivery Revenue',
      platform_commission: 'Commission',
      withdrawal: 'Withdrawal',
      refund: 'Refund',
      adjustment: 'Adjustment',
    };
    return labels[category] || category;
  };

  // Compute balances from ALL transactions (ledger = source of truth)
  const computedMenuBalance = Math.max(0, allTransactions
    .reduce((sum, tx) => {
      if (tx.category === 'vendor_share' && tx.status === 'completed') {
        return tx.transaction_type === 'credit' ? sum + tx.amount : sum - tx.amount;
      }
      if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && tx.notes?.includes('Menu Earnings')) {
        return sum - tx.amount;
      }
      if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && tx.notes?.includes('Menu Earnings')) {
        return sum + tx.amount;
      }
      return sum;
    }, 0));

  const computedMenuPending = Math.max(0, allTransactions
    .filter(tx => tx.category === 'vendor_share' && tx.transaction_type === 'credit' && tx.status === 'pending')
    .reduce((sum, tx) => sum + tx.amount, 0));

  const computedRiderBalance = Math.max(0, allTransactions
    .reduce((sum, tx) => {
      if (tx.category === 'vendor_rider_share' && tx.status === 'completed') {
        return tx.transaction_type === 'credit' ? sum + tx.amount : sum - tx.amount;
      }
      if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && tx.notes?.includes('Rider Revenue')) {
        return sum - tx.amount;
      }
      if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && tx.notes?.includes('Rider Revenue')) {
        return sum + tx.amount;
      }
      return sum;
    }, 0));

  const computedTotalAvailable = computedMenuBalance + computedRiderBalance;

  // Calculate accurate total earned from ledger (net credits minus reversal debits)
  const computedTotalEarned = allTransactions
    .filter(tx => 
      ['vendor_share', 'vendor_rider_share'].includes(tx.category) && 
      tx.status === 'completed'
    )
    .reduce((sum, tx) => {
      if (tx.transaction_type === 'credit') return sum + tx.amount;
      if (tx.transaction_type === 'debit') return sum - tx.amount;
      return sum;
    }, 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success/20 text-success border-0">Completed</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-warning/20 text-warning border-0">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (authLoading || loading || permLoading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar onOutletChange={setSelectedOutletId} />
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

  if (!hasPermission('view_earnings')) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied message="You don't have permission to view earnings." />
        </main>
      </div>
    );
  }

  const commissionRate = vendor?.commission_rate || 15;

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">Earnings</h1>
                {isTestMode && (
                  <Badge variant="outline" className="bg-accent/20 text-accent border-accent/30">
                    <FlaskConical className="w-3 h-3 mr-1" />
                    Test Mode
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">Track your revenue and payouts</p>
              <CommissionDisplay entityType="vendor" entityId={vendor?.id || null} className="mt-1" />
            </div>
            {hasPermission('request_withdrawal') && (
              <Button 
                variant="default" 
                className="gap-2 w-fit"
                onClick={() => navigate('/vendor/withdraw')}
              >
                <ArrowUpRight className="w-4 h-4" />
                Withdraw Funds
              </Button>
            )}
          </div>

          {/* Bank Account Alert */}
          {!wallet?.bank_name && hasPermission('request_withdrawal') && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Bank Account Required</p>
                <p className="text-sm text-muted-foreground">
                  Add your bank account details to receive payouts.{' '}
                  <Button 
                    variant="link" 
                    className="h-auto p-0 text-primary"
                    onClick={() => navigate('/vendor/withdraw')}
                  >
                    Setup now →
                  </Button>
                </p>
              </div>
            </div>
          )}

          {/* Earnings Breakdown Card - New Transparency Feature */}
          <div className="space-y-3">
            <DateRangeFilter 
              dateRange={dateRange} 
              onDateRangeChange={setDateRange}
            />
            {financialBreakdown && financialBreakdown.totalOrders > 0 ? (
              <div className="space-y-4">
                <EarningsBreakdownCard
                  grossAmount={financialBreakdown.grossRevenue}
                  deductions={[
                    {
                      label: 'Platform Commission',
                      amount: financialBreakdown.totalCommission,
                      percentage: financialBreakdown.commissionRate,
                      description: 'Commission calculated on menu price only. Packaging, delivery fees and service fees are not included.',
                    },
                  ]}
                  netAmount={financialBreakdown.netRevenue}
                  title="Menu Earnings Breakdown"
                  period={dateRange.from || dateRange.to 
                    ? `${dateRange.from?.toLocaleDateString() || 'Start'} - ${dateRange.to?.toLocaleDateString() || 'Now'}`
                    : 'All Time'
                  }
                />
                {financialBreakdown.deliveryOrderCount > 0 && (
                  <EarningsBreakdownCard
                    grossAmount={financialBreakdown.deliveryGrossRevenue}
                    deductions={[
                      {
                        label: 'Platform Delivery Fee',
                        amount: financialBreakdown.deliveryPlatformFee,
                        percentage: 20,
                        description: 'Platform takes 20% of delivery fees from vendor-affiliated riders.',
                      },
                    ]}
                    netAmount={financialBreakdown.deliveryNetRevenue}
                    title="Rider Delivery Revenue Breakdown"
                    period={dateRange.from || dateRange.to 
                      ? `${dateRange.from?.toLocaleDateString() || 'Start'} - ${dateRange.to?.toLocaleDateString() || 'Now'}`
                      : `All Time (${financialBreakdown.deliveryOrderCount} deliveries)`
                    }
                  />
                )}
              </div>
            ) : (
              <Card className="p-6 text-center text-muted-foreground text-sm">
                No earnings data for the selected period.
              </Card>
            )}
          </div>

          {/* Understanding Your Earnings */}
          <EarningsExplanation 
            userType="vendor" 
            commissionRate={commissionRate} 
          />

          {/* Revenue Breakdown - Separated Pools */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Menu Sales Revenue */}
            <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/5 to-primary/10">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                    <UtensilsCrossed className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Menu Sales Revenue</h3>
                    <p className="text-xs text-muted-foreground">Earnings from food orders</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Available</p>
                    <p className="text-xl font-bold text-success">
                      {formatCurrency(computedMenuBalance)}
                    </p>
                    <p className="text-xs text-success">Ready to withdraw</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                    <p className="text-xl font-bold text-warning">
                      {formatCurrency(computedMenuPending)}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> 24hr hold
                    </p>
                  </div>
                </div>
                {hasPermission('request_withdrawal') && computedMenuBalance > 0 && (
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="mt-4 w-full"
                    onClick={() => navigate('/vendor/withdraw?source=menu_earnings')}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-1" />
                    Withdraw Menu Earnings
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Rider Delivery Revenue */}
            <Card className="border-0 shadow-soft bg-gradient-to-br from-accent/5 to-accent/10">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                    <Bike className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Rider Delivery Revenue</h3>
                    <p className="text-xs text-muted-foreground">Earnings from affiliated riders</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Available</p>
                    <p className="text-xl font-bold text-success">
                      {formatCurrency(computedRiderBalance)}
                    </p>
                    <p className="text-xs text-success">Ready to withdraw</p>
                  </div>
                  <div className="flex flex-col justify-center">
                    <p className="text-sm text-muted-foreground">No Hold Period</p>
                    <p className="text-xs text-muted-foreground">Available immediately</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  {hasPermission('request_withdrawal') && computedRiderBalance > 0 && (
                    <Button 
                      variant="default" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => navigate('/vendor/withdraw?source=rider_revenue')}
                    >
                      <ArrowUpRight className="w-4 h-4 mr-1" />
                      Withdraw Rider Revenue
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => navigate('/vendor/riders')}
                  >
                    View Riders
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Combined Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Available Balance */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Available</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(computedTotalAvailable)}
                    </p>
                    <p className="text-xs text-success">All sources combined</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Pending Balance */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Pending</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(computedMenuPending)}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Menu sales only
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Earned */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Earned</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(computedTotalEarned)}
                    </p>
                    <p className="text-xs text-muted-foreground">All time</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Withdrawn */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Withdrawn</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(wallet?.total_withdrawn || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Commission: {commissionRate}%
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <ArrowDownRight className="w-6 h-6 text-accent" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {(wallet?.pending_payouts || 0) > 0 && (
            <Card className="border-0 shadow-soft bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <ArrowUpRight className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Pending Payout</p>
                      <p className="text-sm text-muted-foreground">Transfer in progress</p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(wallet?.pending_payouts || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transaction History */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <div className="flex flex-col gap-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Transaction History
                </CardTitle>
                <DateRangeFilter 
                  dateRange={dateRange} 
                  onDateRangeChange={setDateRange}
                />
              </div>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="text-center py-8">
                  <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No transactions yet</p>
                  <p className="text-sm text-muted-foreground">Your earnings will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions
                    .slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE)
                    .map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          tx.transaction_type === 'credit' 
                            ? 'bg-success/10' 
                            : 'bg-destructive/10'
                        }`}>
                          {tx.transaction_type === 'credit' ? (
                            <ArrowDownRight className="w-5 h-5 text-success" />
                          ) : (
                            <ArrowUpRight className="w-5 h-5 text-destructive" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {getCategoryLabel(tx.category)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(tx.created_at).toLocaleDateString('en-NG', {
                              dateStyle: 'medium',
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${
                          tx.transaction_type === 'credit' 
                            ? 'text-success' 
                            : 'text-destructive'
                        }`}>
                          {tx.transaction_type === 'credit' ? '+' : '-'}
                          {formatCurrency(tx.amount)}
                        </p>
                        {getStatusBadge(tx.status)}
                      </div>
                    </div>
                  ))}
                  <PaginationControls
                    currentPage={txPage}
                    totalPages={Math.ceil(transactions.length / TX_PER_PAGE)}
                    onPageChange={setTxPage}
                    totalItems={transactions.length}
                    itemsPerPage={TX_PER_PAGE}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
