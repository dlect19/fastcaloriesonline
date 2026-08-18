import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight, Building2, CreditCard, Settings, Loader2, ShieldCheck, FlaskConical, AlertTriangle, Lock, Package } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { BankAccountForm } from '@/components/BankAccountForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';
import { useRiderPayoutOptions, type PayoutOption, type RiderPayoutQuote } from '@/hooks/useRiderPayoutOptions';
import { RiderWithdrawalPreference } from '@/components/rider/RiderWithdrawalPreference';

interface WalletData {
  id: string;
  balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
  pending_payouts: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  auto_withdraw: boolean;
  auto_withdraw_threshold: number;
  auto_withdraw_day: number;
}

interface WithdrawalRequest {
  id: string;
  amount: number;
  status: string;
  requested_at: string;
  processed_at: string | null;
  notes: string | null;
  reference?: string | null;
  transfer_charge?: number;
  net_amount?: number;
  charge_bearer?: string | null;
  payout_option?: string | null;
}

interface RecipientData {
  created_in_environment: string | null;
}

export default function RiderWithdraw() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // OTP verification state
  const [otpStep, setOtpStep] = useState<'amount' | 'confirm' | 'otp'>('amount');
  const [quote, setQuote] = useState<RiderPayoutQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [recipientEnvironment, setRecipientEnvironment] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');

  // Bank details form
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  // Auto-withdraw settings
  const [autoWithdraw, setAutoWithdraw] = useState(false);
  const [autoWithdrawThreshold, setAutoWithdrawThreshold] = useState('5000');
  const [autoWithdrawDay, setAutoWithdrawDay] = useState('1');

  // Rider restrictions
  const [affiliatedVendorName, setAffiliatedVendorName] = useState<string | null>(null);
  const [deliveryCompanyName, setDeliveryCompanyName] = useState<string | null>(null);
  const { isAffiliated, affiliatedVendorId, isDeliveryCompanyRider, deliveryCompanyId, canWithdraw } = useRiderRestrictions(riderProfile);

  // Withdrawal options (admin-configured charges, minimum, schedules)
  const payoutOptions = useRiderPayoutOptions();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (affiliatedVendorId) {
      fetchVendorName(affiliatedVendorId);
    }
    if (deliveryCompanyId) {
      fetchDeliveryCompanyName(deliveryCompanyId);
    }
  }, [affiliatedVendorId, deliveryCompanyId]);

  const fetchVendorName = async (vendorId: string) => {
    const { data } = await supabase.from('vendors').select('name').eq('id', vendorId).single();
    if (data) setAffiliatedVendorName(data.name);
  };

  const fetchDeliveryCompanyName = async (companyId: string) => {
    const { data } = await supabase.from('delivery_companies').select('name').eq('id', companyId).single();
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
    setUserEmail(user.email || '');
    await fetchData(user.id);
  };

  const fetchData = async (userId: string) => {
    try {
      // Fetch rider wallet specifically
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('wallet_type', 'rider')
        .maybeSingle();

      if (walletData) {
        // Use test columns if in test mode
        const balance = isTestMode 
          ? Number(walletData.test_balance) || 0 
          : Number(walletData.balance) || 0;
        const eligibleBalance = isTestMode 
          ? Number(walletData.test_eligible_balance) || 0 
          : Number(walletData.eligible_balance) || 0;
        
        setWallet({
          ...walletData,
          balance: balance,
          pending_balance: eligibleBalance, // Rider earnings are immediately eligible
          pending_payouts: Number(walletData.pending_payouts) || 0,
        } as WalletData);
        setBankName(walletData.bank_name || '');
        setAccountNumber(walletData.bank_account_number || '');
        setAccountName(walletData.bank_account_name || '');
        setAutoWithdraw(walletData.auto_withdraw || false);
        setAutoWithdrawThreshold(String(walletData.auto_withdraw_threshold || 5000));
        setAutoWithdrawDay(String(walletData.auto_withdraw_day || 1));

        // Fetch immutable withdrawal ledger (falls back to payout requests for legacy rows)
        const { data: ledgerData } = await supabase
          .from('rider_withdrawal_ledger')
          .select('*')
          .eq('rider_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (ledgerData && ledgerData.length > 0) {
          setWithdrawals(ledgerData.map((l) => ({
            id: l.id,
            amount: Number(l.gross_amount) || 0,
            status: l.status || 'requested',
            requested_at: l.created_at,
            processed_at: l.updated_at,
            notes: l.failure_reason,
            reference: l.withdrawal_reference,
            transfer_charge: Number(l.transfer_charge) || 0,
            net_amount: Number(l.net_amount) || 0,
            charge_bearer: l.charge_bearer,
            payout_option: l.payout_option,
          })));
        } else {
          const { data: payoutData } = await supabase
            .from('payout_requests')
            .select('*')
            .eq('wallet_id', walletData.id)
            .order('created_at', { ascending: false })
            .limit(20);

          setWithdrawals((payoutData || []).map(p => ({
            id: p.id,
            amount: p.amount,
            status: p.status || 'pending',
            requested_at: p.created_at,
            processed_at: p.processed_at,
            notes: p.failure_reason,
          })));
        }

        // Fetch recipient environment info
        const { data: recipientData } = await supabase
          .from('paystack_recipients')
          .select('created_in_environment')
          .eq('user_id', userId)
          .eq('is_default', true)
          .maybeSingle();
        
        setRecipientEnvironment(recipientData?.created_in_environment || null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
  };

  const handleUpdateBankDetails = async () => {
    if (!wallet || !bankName || !accountNumber || !accountName) {
      toast({ title: 'Please fill all bank details', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('wallets')
        .update({
          bank_name: bankName,
          bank_account_number: accountNumber,
          bank_account_name: accountName,
        })
        .eq('id', wallet.id);

      if (error) throw error;

      setWallet({ ...wallet, bank_name: bankName, bank_account_number: accountNumber, bank_account_name: accountName });
      setBankDialogOpen(false);
      toast({ title: 'Bank details updated successfully' });
    } catch (error: any) {
      toast({ title: 'Failed to update bank details', description: error.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateAutoWithdraw = async () => {
    if (!wallet) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('wallets')
        .update({
          auto_withdraw: autoWithdraw,
          auto_withdraw_threshold: Number(autoWithdrawThreshold),
          auto_withdraw_day: Number(autoWithdrawDay),
        })
        .eq('id', wallet.id);

      if (error) throw error;

      setWallet({
        ...wallet,
        auto_withdraw: autoWithdraw,
        auto_withdraw_threshold: Number(autoWithdrawThreshold),
        auto_withdraw_day: Number(autoWithdrawDay),
      });
      setSettingsDialogOpen(false);
      toast({ title: 'Withdrawal settings updated' });
    } catch (error: any) {
      toast({ title: 'Failed to update settings', description: error.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1: server-side quote (balance, charge, net, bank, ETA) before any submission
  const handleContinueToConfirm = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    if (!wallet?.bank_name || !wallet?.bank_account_number) {
      toast({ title: 'Please add bank details first', variant: 'destructive' });
      setBankDialogOpen(true);
      return;
    }

    setQuoting(true);
    try {
      const q = await payoutOptions.getQuote(amount);
      setQuote(q);
      if (q.errors.length > 0) {
        toast({ title: 'Cannot withdraw this amount', description: q.errors[0], variant: 'destructive' });
        return;
      }
      setOtpStep('confirm');
    } catch (error: any) {
      toast({ title: 'Could not prepare withdrawal', description: error.message, variant: 'destructive' });
    } finally {
      setQuoting(false);
    }
  };

  // Step 2: rider explicitly confirms, then we send the email OTP
  const handleRequestOTP = async () => {
    const amount = Number(withdrawAmount);
    setSendingOtp(true);
    try {
      const { error } = await supabase.functions.invoke('send-withdrawal-otp', {
        body: {
          email: userEmail,
          userName: 'Rider',
          amount,
          userType: 'rider',
        },
      });

      if (error) throw error;

      // Stable idempotency key for this confirmed attempt — retrying can never duplicate the transfer
      setIdempotencyKey((prev) => prev || `instant:${Date.now()}:${amount}`);
      toast({ title: 'OTP sent!', description: 'Check your email for the verification code.' });
      setOtpStep('otp');
    } catch (error: any) {
      toast({ title: 'Failed to send OTP', description: error.message, variant: 'destructive' });
    } finally {
      setSendingOtp(false);
    }
  };

  // Step 3: verify OTP, then create the withdrawal through the backend (charge + ledger handled server-side)
  const handleVerifyAndWithdraw = async () => {
    if (otp.length !== 6) {
      toast({ title: 'Please enter the 6-digit OTP', variant: 'destructive' });
      return;
    }

    const amount = Number(withdrawAmount);
    setSubmitting(true);
    try {
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-withdrawal-otp', {
        body: { email: userEmail, otp, expectedAmount: amount },
      });

      if (verifyError || !verifyData?.valid) {
        throw new Error('Invalid or expired OTP');
      }

      const result = await payoutOptions.requestWithdrawal(amount, idempotencyKey || undefined);

      if (result.duplicate) {
        toast({ title: 'Withdrawal already submitted', description: 'This request was already received.' });
      } else if (result.processing) {
        toast({
          title: '✅ Withdrawal processing',
          description: `Net ₦${result.net_amount.toLocaleString()} on the way. Ref ${result.withdrawal_reference}.`,
        });
      } else {
        toast({
          title: 'Withdrawal request submitted',
          description: `Ref ${result.withdrawal_reference}. Net ₦${result.net_amount.toLocaleString()} after ₦${result.transfer_charge.toLocaleString()} transfer charge.`,
        });
      }

      setWithdrawDialogOpen(false);
      setWithdrawAmount('');
      setOtp('');
      setQuote(null);
      setIdempotencyKey('');
      setOtpStep('amount');
      checkAuth();
      payoutOptions.refresh();
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
      setQuote(null);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // If rider is affiliated (vendor or delivery company), show restricted view
  if (isAffiliated || isDeliveryCompanyRider) {
    const managerName = isDeliveryCompanyRider ? deliveryCompanyName : affiliatedVendorName;
    const managerType = isDeliveryCompanyRider ? 'delivery company' : 'vendor';
    
    return (
      <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline} canViewEarnings={false}>
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Withdraw</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Rider for {managerName}
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-8 text-center">
            <Lock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">Withdrawals Not Available</h2>
            <p className="text-muted-foreground mb-4">
              As a dedicated rider for {managerName}, withdrawals are managed directly by the {managerType}.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Please contact {managerName} for any questions about your payments.
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline} canViewEarnings={true}>
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Withdraw Funds</h1>
          <p className="text-muted-foreground text-sm md:text-base">Manage your withdrawals and bank settings</p>
        </div>
          <div className="flex gap-2">
            {/* Legacy auto-withdraw settings replaced by the Withdrawal Preference section below */}


            <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Building2 className="w-4 h-4" />
                  Bank Details
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Bank Account Details</DialogTitle>
                  <DialogDescription>Add or update your verified bank account for withdrawals</DialogDescription>
                </DialogHeader>
                <BankAccountForm
                  existingBank={bankName}
                  existingAccountNumber={accountNumber}
                  onSuccess={(data) => {
                    setBankName(data.bankName);
                    setAccountNumber(data.accountNumber);
                    setAccountName(data.accountName);
                    setWallet(wallet ? {
                      ...wallet,
                      bank_name: data.bankName,
                      bank_account_number: data.accountNumber,
                      bank_account_name: data.accountName,
                    } : null);
                    setBankDialogOpen(false);
                  }}
                  onCancel={() => setBankDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Environment Mismatch Warning */}
        {recipientEnvironment && !isTestMode && recipientEnvironment === 'development' && (
          <Card className="border-destructive bg-destructive/10 mb-6">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Bank Details Need Update</p>
                <p className="text-sm text-destructive/90">
                  Your bank details were set up in test mode and cannot be used for real withdrawals. 
                  Please update your bank details to enable production withdrawals.
                </p>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setBankDialogOpen(true)}
                >
                  Update Bank Details
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Card - Riders can withdraw immediately */}
        <Card className="border-green-200 bg-green-50 mb-6">
          <CardContent className="p-4 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium text-green-800">Instant Withdrawals Available</p>
              <p className="text-sm text-green-700">
                As a rider, your earnings are available for immediate withdrawal. 
                No waiting period required!
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Available Balance</CardTitle>
              <Wallet className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(wallet?.balance || 0)}</div>
              <p className="text-xs text-muted-foreground">Ready to withdraw</p>
            </CardContent>
          </Card>

          {/* Withdraw Pending Card */}
          {(wallet?.pending_payouts || 0) > 0 && (
            <Card className="border-2 border-blue-200 bg-blue-50/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-blue-600">Withdraw Pending</CardTitle>
                <Loader2 className="w-4 h-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-700">{formatCurrency(wallet?.pending_payouts || 0)}</div>
                <p className="text-xs text-blue-500">Awaiting admin approval</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Earned</CardTitle>
              <CreditCard className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(wallet?.total_earned || 0)}</div>
              <p className="text-xs text-muted-foreground">All-time earnings</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Withdrawn</CardTitle>
              <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(wallet?.total_withdrawn || 0)}</div>
              <p className="text-xs text-muted-foreground">Successfully withdrawn</p>
            </CardContent>
          </Card>
        </div>

        {/* Withdraw Button */}
        <Dialog open={withdrawDialogOpen} onOpenChange={handleCloseWithdrawDialog}>
          <DialogTrigger asChild>
            <Button size="lg" className="gap-2 mb-8">
              <ArrowUpRight className="w-5 h-5" />
              Request Withdrawal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {otpStep === 'otp' && <ShieldCheck className="w-5 h-5 text-primary" />}
                {otpStep === 'amount' ? 'Request Withdrawal' : otpStep === 'confirm' ? 'Confirm Withdrawal' : 'Verify OTP'}
              </DialogTitle>
              <DialogDescription>
                {otpStep === 'amount'
                  ? 'Withdraw funds to your bank account'
                  : otpStep === 'confirm'
                  ? 'Review the charge and net amount before you confirm'
                  : 'Enter the 6-digit code sent to your email'}
              </DialogDescription>
            </DialogHeader>
            
            {otpStep === 'amount' ? (
              <div className="space-y-4">
                {wallet?.bank_name ? (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Withdrawing to:</p>
                    <p className="font-medium">{wallet.bank_name}</p>
                    <p className="text-sm">{payoutOptions.bank?.masked_account || wallet.bank_account_number} - {wallet.bank_account_name}</p>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 rounded-lg text-center">
                    <p className="text-sm text-yellow-700">Please add bank details first</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => setBankDialogOpen(true)}>
                      Add Bank Details
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Amount (₦)</Label>
                  <Input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="Enter amount"
                    max={payoutOptions.clearedBalance || wallet?.balance || 0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cleared balance: {formatCurrency(payoutOptions.clearedBalance || wallet?.balance || 0)}
                    {payoutOptions.config ? ` · Minimum: ${formatCurrency(payoutOptions.config.min_withdrawal)}` : ''}
                  </p>
                  {payoutOptions.config && (
                    <p className="text-xs text-muted-foreground">
                      Transfer charge for instant withdrawal: {formatCurrency(payoutOptions.config.charge_instant)} (paid by you)
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleContinueToConfirm}
                  className="w-full"
                  disabled={quoting || !wallet?.bank_name}
                >
                  {quoting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Continue
                </Button>
              </div>
            ) : otpStep === 'confirm' && quote ? (
              <div className="space-y-4">
                <div className="rounded-lg border divide-y">
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-muted-foreground">Withdrawable balance</span>
                    <span className="font-medium">{formatCurrency(quote.cleared_balance)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-muted-foreground">Requested amount</span>
                    <span className="font-medium">{formatCurrency(quote.requested)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-muted-foreground">Transfer charge</span>
                    <span className="font-medium text-red-600">
                      {quote.charge_bearer === 'rider' ? `- ${formatCurrency(quote.transfer_charge)}` : 'Paid by FastCalories'}
                    </span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm font-medium">You receive</span>
                    <span className="text-lg font-bold text-primary">{formatCurrency(quote.net_amount)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-muted-foreground">Destination</span>
                    <span className="text-right">
                      {quote.bank.bank_name || '—'}
                      <br />
                      <span className="text-xs text-muted-foreground">{quote.bank.masked_account || ''}</span>
                    </span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-muted-foreground">Processing time</span>
                    <span>{quote.eta_text}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setOtpStep('amount')}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleRequestOTP}
                    disabled={sendingOtp}
                  >
                    {sendingOtp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Confirm &amp; Send Code
                  </Button>
                </div>
              </div>
            ) : otpStep === 'confirm' ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Preparing your withdrawal…</div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-1">Withdrawing</p>
                  <p className="text-2xl font-bold text-primary">{formatCurrency(Number(withdrawAmount))}</p>
                  <p className="text-xs text-muted-foreground mt-1">to {wallet?.bank_name}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-center block">Enter OTP</Label>
                  <div className="flex justify-center">
                    <InputOTP value={otp} onChange={setOtp} maxLength={6}>
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
                  <p className="text-xs text-muted-foreground text-center">
                    Code sent to {userEmail}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => setOtpStep('amount')} 
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button 
                    onClick={handleVerifyAndWithdraw} 
                    className="flex-1" 
                    disabled={submitting || otp.length !== 6}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Confirm Withdrawal
                  </Button>
                </div>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full text-muted-foreground"
                  onClick={handleRequestOTP}
                  disabled={sendingOtp}
                >
                  {sendingOtp ? 'Sending...' : 'Resend Code'}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Withdrawal History */}
        <Card>
          <CardHeader>
            <CardTitle>Withdrawal History</CardTitle>
            <CardDescription>Your recent withdrawal requests</CardDescription>
          </CardHeader>
          <CardContent>
            {withdrawals.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No withdrawal requests yet</p>
            ) : (
              <div className="space-y-4">
                {withdrawals.map((withdrawal) => (
                  <div key={withdrawal.id} className="flex items-center justify-between py-3 border-b last:border-0">
                    <div>
                      <p className="font-medium">{formatCurrency(withdrawal.amount)}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(withdrawal.requested_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className={getStatusColor(withdrawal.status)}>
                      {withdrawal.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
    </RiderLayout>
  );
}
