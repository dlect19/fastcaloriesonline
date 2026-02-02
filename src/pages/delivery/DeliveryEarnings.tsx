import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, Calendar, Package, ArrowUpRight, ArrowDownLeft, Percent } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { supabase } from '@/integrations/supabase/client';

interface EarningsStats {
  totalEarned: number;
  availableBalance: number;
  eligibleBalance: number;
  pendingBalance: number;
  todayEarnings: number;
  weekEarnings: number;
  monthEarnings: number;
  totalDeliveries: number;
  commissionRate: number;
}

export default function DeliveryEarnings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { company, loading: companyLoading } = useDeliveryCompany();
  const { isTestMode } = useEnvironmentConfig();
  const [stats, setStats] = useState<EarningsStats | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      fetchEarningsData();
    }
  }, [user, authLoading, company, navigate]);

  const fetchEarningsData = async () => {
    if (!company) return;

    try {
      // Get or create delivery company wallet
      let { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', company.user_id)
        .eq('wallet_type', 'delivery_company')
        .maybeSingle();

      if (!walletData) {
        // Create wallet if doesn't exist
        const { data: newWallet, error } = await supabase
          .from('wallets')
          .insert({
            user_id: company.user_id,
            wallet_type: 'delivery_company',
          })
          .select()
          .single();

        if (!error) {
          walletData = newWallet;
        }
      }

      if (walletData) {
        setWalletId(walletData.id);

        const availableBalance = isTestMode
          ? Number(walletData.test_balance) || 0
          : Number(walletData.balance) || 0;
        const eligibleBalance = isTestMode
          ? Number(walletData.test_eligible_balance) || 0
          : Number(walletData.eligible_balance) || 0;
        const pendingBalance = isTestMode
          ? Number(walletData.test_pending_balance) || 0
          : Number(walletData.pending_balance) || 0;
        const totalEarned = Number(walletData.total_earned) || 0;

        // Calculate time-based earnings
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const { data: transactions } = await supabase
          .from('wallet_transactions')
          .select('amount, created_at')
          .eq('wallet_id', walletData.id)
          .eq('category', 'delivery_company_share')
          .eq('transaction_type', 'credit');

        let todayEarnings = 0;
        let weekEarnings = 0;
        let monthEarnings = 0;
        let totalDeliveries = 0;

        transactions?.forEach((tx) => {
          const txDate = new Date(tx.created_at);
          const amount = Number(tx.amount);
          totalDeliveries++;

          if (txDate >= today) {
            todayEarnings += amount;
          }
          if (txDate >= weekAgo) {
            weekEarnings += amount;
          }
          if (txDate >= monthAgo) {
            monthEarnings += amount;
          }
        });

        setStats({
          totalEarned,
          availableBalance,
          eligibleBalance,
          pendingBalance,
          todayEarnings,
          weekEarnings,
          monthEarnings,
          totalDeliveries,
          commissionRate: company.commission_rate,
        });
      }
    } catch (error) {
      console.error('Error fetching earnings:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

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

  return (
    <div className="min-h-screen bg-background">
      <DeliverySidebar companyName={company?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Earnings</h1>
              <p className="text-muted-foreground">Track your delivery revenue</p>
            </div>
            <Button onClick={() => navigate('/delivery/withdraw')}>
              <ArrowUpRight className="w-4 h-4 mr-2" />
              Withdraw Funds
            </Button>
          </div>

          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">Available Balance</p>
                    <p className="text-3xl font-bold">{formatCurrency(stats?.availableBalance || 0)}</p>
                  </div>
                  <Wallet className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Earned</p>
                    <p className="text-2xl font-bold">{formatCurrency(stats?.totalEarned || 0)}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-success" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Deliveries</p>
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
                    <p className="text-sm text-muted-foreground">Platform Commission</p>
                    <p className="text-2xl font-bold">{stats?.commissionRate || 20}%</p>
                  </div>
                  <Percent className="w-8 h-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Time-based Earnings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-full bg-success/10">
                    <Calendar className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Today</p>
                    <p className="text-xl font-bold">{formatCurrency(stats?.todayEarnings || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">This Week</p>
                    <p className="text-xl font-bold">{formatCurrency(stats?.weekEarnings || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-full bg-accent/10">
                    <Calendar className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">This Month</p>
                    <p className="text-xl font-bold">{formatCurrency(stats?.monthEarnings || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Breakdown Info */}
          <Card>
            <CardHeader>
              <CardTitle>How Earnings Work</CardTitle>
              <CardDescription>Understanding your delivery revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                  <ArrowDownLeft className="w-8 h-8 text-success" />
                  <div>
                    <p className="font-medium">Customer Pays Delivery Fee</p>
                    <p className="text-sm text-muted-foreground">
                      When a customer places an order, they pay the delivery fee.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                  <Percent className="w-8 h-8 text-primary" />
                  <div>
                    <p className="font-medium">Platform Commission: {stats?.commissionRate || 20}%</p>
                    <p className="text-sm text-muted-foreground">
                      Fast Calories retains {stats?.commissionRate || 20}% of the delivery fee as platform commission.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                  <Wallet className="w-8 h-8 text-accent" />
                  <div>
                    <p className="font-medium">Your Share: {100 - (stats?.commissionRate || 20)}%</p>
                    <p className="text-sm text-muted-foreground">
                      You receive {100 - (stats?.commissionRate || 20)}% of the delivery fee, credited instantly.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction History */}
          {walletId && (
            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
                <CardDescription>All credits and debits</CardDescription>
              </CardHeader>
              <CardContent>
              <TransactionHistory 
                walletId={walletId} 
              />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
