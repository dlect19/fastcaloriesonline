import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DollarSign, TrendingUp, Wallet, ArrowUpRight, Loader2, FlaskConical, Lock, Package, Calendar, Percent, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { EarningsBreakdownCard } from '@/components/shared/EarningsBreakdownCard';
import { EarningsExplanation } from '@/components/shared/EarningsExplanation';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function RiderEarnings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [payoutDetails, setPayoutDetails] = useState<any[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [affiliatedVendorName, setAffiliatedVendorName] = useState<string | null>(null);
  const [deliveryCompanyName, setDeliveryCompanyName] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  // Use rider restrictions hook
  const { isAffiliated, affiliatedVendorId, isDeliveryCompanyRider, deliveryCompanyId, canViewEarnings } = useRiderRestrictions(riderProfile);

  useEffect(() => {
    checkAuth();
  }, [dateRange]);

  // Fetch affiliated vendor name
  useEffect(() => {
    if (affiliatedVendorId) {
      fetchVendorName(affiliatedVendorId);
    }
    if (deliveryCompanyId) {
      fetchDeliveryCompanyName(deliveryCompanyId);
    }
  }, [affiliatedVendorId, deliveryCompanyId]);

  const fetchVendorName = async (vendorId: string) => {
    const { data } = await supabase
      .from('vendors')
      .select('name')
      .eq('id', vendorId)
      .single();
    if (data) setAffiliatedVendorName(data.name);
  };

  const fetchDeliveryCompanyName = async (companyId: string) => {
    const { data } = await supabase
      .from('delivery_companies')
      .select('name')
      .eq('id', companyId)
      .single();
    if (data) setDeliveryCompanyName(data.name);
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    setRiderProfile(profile);
    setIsOnline(profile?.is_online || false);
    await fetchEarnings(user.id);
  };

  const fetchEarnings = async (userId: string) => {
    try {
      // Fetch specifically the rider wallet
      let { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('wallet_type', 'rider')
        .maybeSingle();

      if (!walletData) {
        // Create a new rider wallet if it doesn't exist
        const { data: newWallet } = await supabase
          .from('wallets')
          .insert({ 
            user_id: userId, 
            wallet_type: 'rider', 
            balance: 0, 
            eligible_balance: 0, 
            pending_balance: 0, 
            total_earned: 0, 
            total_withdrawn: 0 
          })
          .select()
          .single();
        walletData = newWallet;
      }

      setWallet(walletData);

      if (walletData) {
        let txQuery = supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(100);

        if (dateRange.from) {
          txQuery = txQuery.gte('created_at', dateRange.from.toISOString());
        }
        if (dateRange.to) {
          const endOfToDate = new Date(dateRange.to);
          endOfToDate.setHours(23, 59, 59, 999);
          txQuery = txQuery.lte('created_at', endOfToDate.toISOString());
        }

        const { data: txns } = await txQuery;
        setTransactions(txns || []);
      }

      // Fetch payout details for this rider
      let detailsQuery = supabase
        .from('rider_payout_details')
        .select('*')
        .eq('rider_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (dateRange.from) {
        detailsQuery = detailsQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endOfToDate = new Date(dateRange.to);
        endOfToDate.setHours(23, 59, 59, 999);
        detailsQuery = detailsQuery.lte('created_at', endOfToDate.toISOString());
      }

      const { data: details } = await detailsQuery;
      setPayoutDetails(details || []);
    } catch (error) {
      console.error('Error fetching earnings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    toast({ title: 'Withdrawal requested', description: 'Your withdrawal request has been submitted.' });
    setWithdrawDialogOpen(false);
    setWithdrawAmount('');
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('rider_profiles').update({ is_online: online }).eq('user_id', user.id);
    setIsOnline(online);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // If rider is affiliated (vendor or delivery company), show restricted view
  if (isAffiliated || isDeliveryCompanyRider) {
    const managerName = isDeliveryCompanyRider ? deliveryCompanyName : affiliatedVendorName;
    const managerType = isDeliveryCompanyRider ? 'delivery company' : 'vendor';
    
    return (
      <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline} canViewEarnings={false}>
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Deliveries</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Rider for {managerName}
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-8 text-center">
            <Lock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">Earnings Not Available</h2>
            <p className="text-muted-foreground mb-4">
              As a dedicated rider for {managerName}, your earnings are managed directly by the {managerType}.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Please contact {managerName} for any questions about your compensation.
            </p>
            <Button variant="outline" onClick={() => navigate('/rider/orders')}>
              <Package className="w-4 h-4 mr-2" />
              View My Deliveries
            </Button>
          </CardContent>
        </Card>
      </RiderLayout>
    );
  }

  // Platform rider - show full earnings
  const balance = isTestMode 
    ? (Number(wallet?.test_balance) || 0) 
    : (Number(wallet?.balance) || 0);
  const eligibleBalance = isTestMode 
    ? (Number(wallet?.test_eligible_balance) || 0) 
    : (Number(wallet?.eligible_balance) || 0);
  const totalEarned = isTestMode 
    ? transactions.filter(t => t.transaction_type === 'credit').reduce((sum, t) => sum + Number(t.amount), 0)
    : (Number(wallet?.total_earned) || 0);

  // Calculate earnings from payout details if available, otherwise fallback
  const totalPlatformFees = payoutDetails.reduce((sum, d) => sum + Number(d.platform_fee || 0), 0);
  const totalDistanceBonus = payoutDetails.reduce((sum, d) => sum + Number(d.distance_bonus || 0), 0);
  const totalSurgeBonus = payoutDetails.reduce((sum, d) => sum + Number(d.total_surge_bonus || 0), 0);
  const totalSubsidies = payoutDetails.reduce((sum, d) => sum + Number(d.subsidy_amount || 0), 0);
  const totalDeliveryFees = payoutDetails.reduce((sum, d) => sum + Number(d.delivery_fee || 0), 0);
  const totalFinalPay = payoutDetails.reduce((sum, d) => sum + Number(d.final_rider_pay || 0), 0);

  // Fallback to old calculation if no payout details exist
  const riderShareTransactions = transactions.filter(t => t.category === 'rider_share' && t.transaction_type === 'credit');
  const grossDeliveryFees = payoutDetails.length > 0 
    ? totalDeliveryFees
    : riderShareTransactions.reduce((sum, t) => sum + (Number(t.amount) / 0.8), 0);
  const platformCommission = payoutDetails.length > 0 
    ? totalPlatformFees
    : grossDeliveryFees * 0.2;
  const netRiderEarnings = payoutDetails.length > 0
    ? totalFinalPay
    : grossDeliveryFees - platformCommission;

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline} canViewEarnings={true}>
      <div className="mb-6 md:mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Earnings</h1>
          {isTestMode && (
            <Badge variant="outline" className="bg-accent/20 text-accent border-accent/30">
              <FlaskConical className="w-3 h-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm md:text-base">Track your income and withdrawals</p>
      </div>

      {/* Earnings Breakdown - New Transparency Feature */}
      {grossDeliveryFees > 0 && (
        <div className="mb-6">
          <EarningsBreakdownCard
            grossAmount={grossDeliveryFees}
            deductions={[
              {
                label: 'Platform Fee (capped)',
                amount: platformCommission,
                percentage: grossDeliveryFees > 0 ? Math.round((platformCommission / grossDeliveryFees) * 100) : 0,
                description: 'Capped platform fee: min ₦300, max ₦700',
              },
              ...(totalDistanceBonus > 0 ? [{
                label: 'Distance Bonus',
                amount: -totalDistanceBonus,
                description: '₦100 per km beyond 4km threshold',
              }] : []),
              ...(totalSurgeBonus > 0 ? [{
                label: 'Surge Bonuses',
                amount: -totalSurgeBonus,
                description: 'Time & weather surge bonuses',
              }] : []),
              ...(totalSubsidies > 0 ? [{
                label: 'Minimum Guarantee Top-ups',
                amount: -totalSubsidies,
                description: 'Platform subsidy to ensure ₦900 minimum payout',
              }] : []),
            ]}
            netAmount={netRiderEarnings}
            title="Delivery Earnings Breakdown"
            period={dateRange.from || dateRange.to 
              ? `${dateRange.from?.toLocaleDateString() || 'Start'} - ${dateRange.to?.toLocaleDateString() || 'Now'}`
              : 'All Time'
            }
          />
        </div>
      )}

      {/* Understanding Your Earnings */}
      <div className="mb-6">
        <EarningsExplanation userType="rider" commissionRate={20} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Available Balance</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">₦{balance.toLocaleString()}</div>
            <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="mt-2 w-full md:w-auto" disabled={isTestMode}>
                  <ArrowUpRight className="w-4 h-4 mr-1" />
                  {isTestMode ? 'Test Mode' : 'Withdraw'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Withdraw Funds</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Amount (₦)</Label>
                    <Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="Enter amount" />
                    <p className="text-xs text-muted-foreground">Available: ₦{balance.toLocaleString()}</p>
                  </div>
                  <Button onClick={handleWithdraw} className="w-full">Request Withdrawal</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Total Earned</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">₦{totalEarned.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Total Withdrawn</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">₦{(wallet?.total_withdrawn || 0).toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
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
            <p className="text-muted-foreground text-center py-6 md:py-8 text-sm md:text-base">No transactions yet</p>
          ) : (
            <div className="space-y-4">
              {transactions.map((txn) => (
                <div key={txn.id} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm md:text-base truncate capitalize">{txn.category?.replace(/_/g, ' ') || txn.transaction_type}</p>
                    <p className="text-xs md:text-sm text-muted-foreground">{new Date(txn.created_at).toLocaleDateString()}</p>
                  </div>
                  <p className={`font-bold text-sm md:text-base ml-2 ${txn.transaction_type === 'credit' ? 'text-calorie-low' : 'text-destructive'}`}>
                    {txn.transaction_type === 'credit' ? '+' : '-'}₦{Number(txn.amount).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </RiderLayout>
  );
}
