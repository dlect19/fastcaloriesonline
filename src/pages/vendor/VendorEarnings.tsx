import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownRight, Calendar, Clock, AlertCircle, FlaskConical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { supabase } from '@/integrations/supabase/client';
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
  metadata: Record<string, unknown>;
}

export default function VendorEarnings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { isTestMode } = useEnvironmentConfig();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [wallet, setWallet] = useState<VendorWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

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

      // Get or create wallet for vendor - specifically the vendor wallet
      let { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', vendorOwnerId)
        .eq('wallet_type', 'vendor')
        .maybeSingle();

      // Auto-create wallet if it doesn't exist for vendor
      if (!walletData && vendorOwnerId) {
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({
            user_id: vendorOwnerId,
            wallet_type: 'vendor',
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
        // Total earned from transactions for test mode
        const totalEarned = isTestMode ? 0 : Number(walletData.total_earned) || 0;
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
        });

        // Get recent transactions - filter by environment in test mode
        const { data: txData } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (txData) {
          setTransactions(txData.map(tx => ({
            id: tx.id,
            wallet_type: tx.wallet_type,
            transaction_type: tx.transaction_type,
            category: tx.category,
            amount: Number(tx.amount),
            status: tx.status || 'completed',
            order_id: tx.order_id,
            created_at: tx.created_at,
            metadata: (tx.metadata as Record<string, unknown>) || {},
          })));
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
      platform_commission: 'Commission',
      withdrawal: 'Withdrawal',
      refund: 'Refund',
      adjustment: 'Adjustment',
    };
    return labels[category] || category;
  };

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

  if (!hasPermission('view_earnings')) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor?.name} permissions={permissions} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied message="You don't have permission to view earnings." />
        </main>
      </div>
    );
  }

  const commissionRate = vendor?.commission_rate || 15;

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} permissions={permissions} />

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

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Available Balance */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Available Balance</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(wallet?.eligible_balance || 0)}
                    </p>
                    <p className="text-xs text-success">Ready to withdraw</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pending Balance */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Balance</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(wallet?.pending_balance || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> 24hr hold
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
                      {formatCurrency(wallet?.total_earned || 0)}
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

          {/* Pending Payouts Info */}
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
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Transaction History
              </CardTitle>
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
                  {transactions.map((tx) => (
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
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
