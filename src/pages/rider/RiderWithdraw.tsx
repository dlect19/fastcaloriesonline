import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight, Building2, CreditCard, Settings, Loader2, ShieldCheck } from 'lucide-react';
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
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WalletData {
  id: string;
  balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
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
}

const NIGERIAN_BANKS = [
  'Access Bank', 'Citibank', 'Ecobank', 'Fidelity Bank', 'First Bank',
  'First City Monument Bank', 'Guaranty Trust Bank', 'Heritage Bank', 
  'Keystone Bank', 'Polaris Bank', 'Providus Bank', 'Stanbic IBTC Bank',
  'Standard Chartered Bank', 'Sterling Bank', 'Titan Trust Bank',
  'Union Bank', 'United Bank for Africa', 'Unity Bank', 'Wema Bank', 'Zenith Bank'
];

export default function RiderWithdraw() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // OTP verification state
  const [otpStep, setOtpStep] = useState<'amount' | 'otp'>('amount');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Bank details form
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  // Auto-withdraw settings
  const [autoWithdraw, setAutoWithdraw] = useState(false);
  const [autoWithdrawThreshold, setAutoWithdrawThreshold] = useState('5000');
  const [autoWithdrawDay, setAutoWithdrawDay] = useState('1');

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
    setUserEmail(user.email || '');
    await fetchData(user.id);
  };

  const fetchData = async (userId: string) => {
    try {
      // Fetch wallet
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (walletData) {
        setWallet(walletData as WalletData);
        setBankName(walletData.bank_name || '');
        setAccountNumber(walletData.bank_account_number || '');
        setAccountName(walletData.bank_account_name || '');
        setAutoWithdraw(walletData.auto_withdraw || false);
        setAutoWithdrawThreshold(String(walletData.auto_withdraw_threshold || 5000));
        setAutoWithdrawDay(String(walletData.auto_withdraw_day || 1));

        // Fetch withdrawal requests
        const { data: withdrawalData } = await supabase
          .from('withdrawal_requests')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('requested_at', { ascending: false })
          .limit(20);

        setWithdrawals(withdrawalData || []);
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

  const handleRequestOTP = async () => {
    const amount = Number(withdrawAmount);
    const availableBalance = wallet?.balance || 0;

    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > availableBalance) {
      toast({ title: 'Amount exceeds available balance', variant: 'destructive' });
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
          email: userEmail,
          userName: 'Rider',
          amount,
          userType: 'rider',
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setSubmitting(true);
    try {
      // Verify OTP
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-withdrawal-otp', {
        body: {
          email: userEmail,
          otp,
          expectedAmount: amount,
        },
      });

      if (verifyError || !verifyData?.valid) {
        throw new Error('Invalid or expired OTP');
      }

      // Process withdrawal
      const { error } = await supabase
        .from('withdrawal_requests')
        .insert({
          wallet_id: wallet!.id,
          user_id: user.id,
          amount,
          bank_name: wallet!.bank_name,
          bank_account_number: wallet!.bank_account_number,
          bank_account_name: wallet!.bank_account_name || '',
          user_type: 'rider',
        });

      if (error) throw error;

      toast({ title: 'Withdrawal request submitted', description: 'Your request will be processed shortly.' });
      setWithdrawDialogOpen(false);
      setWithdrawAmount('');
      setOtp('');
      setOtpStep('amount');
      checkAuth();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Withdraw Funds</h1>
          <p className="text-muted-foreground text-sm md:text-base">Manage your withdrawals and bank settings</p>
        </div>
          <div className="flex gap-2">
            <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Settings
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Withdrawal Settings</DialogTitle>
                  <DialogDescription>Configure automatic withdrawals</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-withdraw</Label>
                      <p className="text-sm text-muted-foreground">Automatically withdraw when threshold is reached</p>
                    </div>
                    <Switch checked={autoWithdraw} onCheckedChange={setAutoWithdraw} />
                  </div>
                  {autoWithdraw && (
                    <>
                      <div className="space-y-2">
                        <Label>Minimum threshold (₦)</Label>
                        <Input
                          type="number"
                          value={autoWithdrawThreshold}
                          onChange={(e) => setAutoWithdrawThreshold(e.target.value)}
                          placeholder="5000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Preferred withdrawal day</Label>
                        <Select value={autoWithdrawDay} onValueChange={setAutoWithdrawDay}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day, i) => (
                              <SelectItem key={i} value={String(i + 1)}>{day}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  <Button onClick={handleUpdateAutoWithdraw} className="w-full" disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save Settings
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Building2 className="w-4 h-4" />
                  Bank Details
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Bank Account Details</DialogTitle>
                  <DialogDescription>Add or update your bank account for withdrawals</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Bank Name</Label>
                    <Select value={bankName} onValueChange={setBankName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {NIGERIAN_BANKS.map((bank) => (
                          <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="0123456789"
                      maxLength={10}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Name</Label>
                    <Input
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="John Doe"
                    />
                  </div>
                  <Button onClick={handleUpdateBankDetails} className="w-full" disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save Bank Details
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
                {otpStep === 'amount' ? 'Request Withdrawal' : 'Verify OTP'}
              </DialogTitle>
              <DialogDescription>
                {otpStep === 'amount' 
                  ? 'Withdraw funds to your bank account' 
                  : 'Enter the 6-digit code sent to your email'}
              </DialogDescription>
            </DialogHeader>
            
            {otpStep === 'amount' ? (
              <div className="space-y-4">
                {wallet?.bank_name ? (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Withdrawing to:</p>
                    <p className="font-medium">{wallet.bank_name}</p>
                    <p className="text-sm">{wallet.bank_account_number} - {wallet.bank_account_name}</p>
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
                    max={wallet?.balance || 0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Available balance: {formatCurrency(wallet?.balance || 0)}
                  </p>
                </div>

                <Button 
                  onClick={handleRequestOTP} 
                  className="w-full" 
                  disabled={sendingOtp || !wallet?.bank_name}
                >
                  {sendingOtp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Send Verification Code
                </Button>
              </div>
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
