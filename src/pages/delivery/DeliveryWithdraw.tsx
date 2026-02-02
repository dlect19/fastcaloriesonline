import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight, Building2, Clock, Settings, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { BankAccountForm } from '@/components/BankAccountForm';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface WalletData {
  id: string;
  balance: number;
  eligible_balance: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
}

interface PayoutRequest {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  processed_at: string | null;
  failure_reason: string | null;
}

export default function DeliveryWithdraw() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { company, loading: companyLoading, isOwner } = useDeliveryCompany();
  const { isTestMode } = useEnvironmentConfig();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // OTP state
  const [otpStep, setOtpStep] = useState<'amount' | 'otp'>('amount');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      fetchData();
    }
  }, [user, authLoading, company, navigate]);

  const fetchData = async () => {
    if (!company) return;

    try {
      // Fetch delivery company wallet
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', company.user_id)
        .eq('wallet_type', 'delivery_company')
        .maybeSingle();

      if (walletData) {
        const balance = isTestMode
          ? Number(walletData.test_balance) || 0
          : Number(walletData.balance) || 0;
        const eligibleBalance = isTestMode
          ? Number(walletData.test_eligible_balance) || 0
          : Number(walletData.eligible_balance) || 0;

        setWallet({
          id: walletData.id,
          balance,
          eligible_balance: eligibleBalance,
          bank_name: walletData.bank_name,
          bank_account_number: walletData.bank_account_number,
          bank_account_name: walletData.bank_account_name,
        });

        // Fetch payout history
        const { data: payoutData } = await supabase
          .from('payout_requests')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(20);

        setPayouts(payoutData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOTP = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (!wallet || amount > wallet.eligible_balance) {
      toast({ title: 'Amount exceeds eligible balance', variant: 'destructive' });
      return;
    }

    if (!wallet?.bank_name || !wallet?.bank_account_number) {
      toast({ title: 'Please add bank details first', variant: 'destructive' });
      setBankDialogOpen(true);
      return;
    }

    setSendingOtp(true);
    try {
      const { error } = await supabase.functions.invoke('send-withdrawal-otp', {
        body: {
          email: user?.email,
          userName: company?.name,
          amount,
          userType: 'delivery_company',
        },
      });

      if (error) throw error;

      toast({ title: 'OTP sent!', description: 'Check your email for the verification code.' });
      setOtpStep('otp');
    } catch (error: any) {
      toast({ title: 'Failed to send OTP', description: error.message, variant: 'destructive' });
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyAndWithdraw = async () => {
    if (otp.length !== 6) {
      toast({ title: 'Please enter the 6-digit OTP', variant: 'destructive' });
      return;
    }

    const amount = Number(withdrawAmount);

    setSubmitting(true);
    try {
      // Verify OTP
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-withdrawal-otp', {
        body: {
          email: user?.email,
          otp,
          expectedAmount: amount,
        },
      });

      if (verifyError || !verifyData?.valid) {
        throw new Error('Invalid or expired OTP');
      }

      // Create payout request
      const { error } = await supabase
        .from('payout_requests')
        .insert({
          wallet_id: wallet!.id,
          user_id: user?.id,
          amount,
          bank_name: wallet!.bank_name,
          bank_account_number: wallet!.bank_account_number,
          bank_account_name: wallet!.bank_account_name || '',
          user_type: 'delivery_company',
          status: 'pending',
        });

      if (error) throw error;

      toast({ title: 'Withdrawal request submitted', description: 'Pending admin approval.' });
      setWithdrawDialogOpen(false);
      setWithdrawAmount('');
      setOtp('');
      setOtpStep('amount');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Withdrawal failed', description: error.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseWithdrawDialog = (open: boolean) => {
    setWithdrawDialogOpen(open);
    if (!open) {
      setOtpStep('amount');
      setOtp('');
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className: string }> = {
      pending: { variant: 'secondary', className: 'bg-yellow-100 text-yellow-800' },
      processing: { variant: 'secondary', className: 'bg-blue-100 text-blue-800' },
      completed: { variant: 'default', className: 'bg-green-100 text-green-800' },
      failed: { variant: 'destructive', className: '' },
    };
    const config = variants[status] || { variant: 'secondary', className: '' };
    return <Badge variant={config.variant} className={config.className}>{status}</Badge>;
  };

  if (authLoading || companyLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar companyName={company?.name} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="w-16 h-16 text-destructive mb-4" />
                <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
                <p className="text-muted-foreground text-center">
                  Only company owners can request withdrawals.
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
      <DeliverySidebar companyName={company?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Withdraw Funds</h1>
              <p className="text-muted-foreground">Transfer earnings to your bank account</p>
            </div>
            <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Building2 className="w-4 h-4" />
                  Bank Details
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Bank Account Details</DialogTitle>
                  <DialogDescription>Add or update your withdrawal bank account</DialogDescription>
                </DialogHeader>
                <BankAccountForm
                  existingBank={wallet?.bank_name || ''}
                  existingAccountNumber={wallet?.bank_account_number || ''}
                  onSuccess={(data) => {
                    setWallet(prev => prev ? {
                      ...prev,
                      bank_name: data.bankName,
                      bank_account_number: data.accountNumber,
                      bank_account_name: data.accountName,
                    } : null);
                    setBankDialogOpen(false);
                    toast({ title: 'Bank details updated!' });
                  }}
                  onCancel={() => setBankDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">Available Balance</p>
                    <p className="text-3xl font-bold">{formatCurrency(wallet?.balance || 0)}</p>
                  </div>
                  <Wallet className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Eligible for Withdrawal</p>
                    <p className="text-2xl font-bold text-success">{formatCurrency(wallet?.eligible_balance || 0)}</p>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">Bank Account</p>
                  {wallet?.bank_name ? (
                    <div>
                      <p className="font-medium">{wallet.bank_name}</p>
                      <p className="text-sm text-muted-foreground">{wallet.bank_account_number}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-warning">Not configured</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Withdraw Button */}
          <Card>
            <CardContent className="pt-6">
              <Dialog open={withdrawDialogOpen} onOpenChange={handleCloseWithdrawDialog}>
                <DialogTrigger asChild>
                  <Button className="w-full gap-2" size="lg" disabled={!wallet?.eligible_balance}>
                    <ArrowUpRight className="w-5 h-5" />
                    Request Withdrawal
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Withdraw Funds</DialogTitle>
                    <DialogDescription>
                      {otpStep === 'amount' 
                        ? 'Enter the amount you want to withdraw'
                        : 'Enter the OTP sent to your email'}
                    </DialogDescription>
                  </DialogHeader>

                  {otpStep === 'amount' ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Amount (₦)</Label>
                        <Input
                          type="number"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="Enter amount"
                          max={wallet?.eligible_balance}
                        />
                        <p className="text-sm text-muted-foreground">
                          Max: {formatCurrency(wallet?.eligible_balance || 0)}
                        </p>
                      </div>
                      <Button 
                        onClick={handleRequestOTP} 
                        className="w-full"
                        disabled={sendingOtp}
                      >
                        {sendingOtp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Send OTP
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="text-center mb-4">
                        <p className="text-lg font-semibold">Withdrawing {formatCurrency(Number(withdrawAmount))}</p>
                        <p className="text-sm text-muted-foreground">To: {wallet?.bank_name}</p>
                      </div>
                      <div className="flex justify-center">
                        <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      <Button 
                        onClick={handleVerifyAndWithdraw} 
                        className="w-full"
                        disabled={submitting}
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Confirm Withdrawal
                      </Button>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Withdrawal History */}
          <Card>
            <CardHeader>
              <CardTitle>Withdrawal History</CardTitle>
              <CardDescription>Your recent payout requests</CardDescription>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No withdrawal requests yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {payouts.map((payout) => (
                    <div key={payout.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{formatCurrency(payout.amount)}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(payout.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        {getStatusBadge(payout.status)}
                        {payout.failure_reason && (
                          <p className="text-xs text-destructive mt-1">{payout.failure_reason}</p>
                        )}
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
