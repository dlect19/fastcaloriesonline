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
import { DollarSign, TrendingUp, Wallet, ArrowUpRight, Loader2, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

export default function RiderEarnings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('is_online')
      .eq('user_id', user.id)
      .maybeSingle();

    setIsOnline(profile?.is_online || false);
    await fetchEarnings(user.id);
  };

  const fetchEarnings = async (userId: string) => {
    try {
      let { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('wallet_type', 'rider')
        .maybeSingle();

      if (!walletData) {
        const { data: existingWallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingWallet) {
          const { data: updated } = await supabase
            .from('wallets')
            .update({ wallet_type: 'rider' })
            .eq('id', existingWallet.id)
            .select()
            .single();
          walletData = updated;
        } else {
          const { data: newWallet } = await supabase
            .from('wallets')
            .insert({ user_id: userId, wallet_type: 'rider', balance: 0, eligible_balance: 0, pending_balance: 0, total_earned: 0, total_withdrawn: 0 })
            .select()
            .single();
          walletData = newWallet;
        }
      }

      setWallet(walletData);

      if (walletData) {
        const { data: txns } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(20);

        setTransactions(txns || []);
      }
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

  const balance = isTestMode ? (Number(wallet?.test_balance) || 0) : (Number(wallet?.balance) || 0);
  const totalEarned = isTestMode 
    ? transactions.filter(t => t.transaction_type === 'credit').reduce((sum, t) => sum + Number(t.amount), 0)
    : (Number(wallet?.total_earned) || 0);

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
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
          <CardTitle className="text-lg md:text-xl">Transaction History</CardTitle>
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
