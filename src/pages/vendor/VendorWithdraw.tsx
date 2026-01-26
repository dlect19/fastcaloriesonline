import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight, Building2, CreditCard, Clock, Settings, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;

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

export default function VendorWithdraw() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [eligibleBalance, setEligibleBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // OTP verification state
  const [otpStep, setOtpStep] = useState<'amount' | 'otp'>('amount');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  // Bank details form
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  // Auto-withdraw settings
  const [autoWithdraw, setAutoWithdraw] = useState(false);
  const [autoWithdrawThreshold, setAutoWithdrawThreshold] = useState('5000');
  const [autoWithdrawDay, setAutoWithdrawDay] = useState('1');

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
      // Fetch vendor
      const { data: vendorData } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      setVendor(vendorData);

      // Fetch wallet
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user?.id)
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

      // Calculate eligible balance (orders delivered 24+ hours ago)
      if (vendorData) {
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        const { data: eligibleOrders } = await supabase
          .from('orders')
          .select('subtotal')
          .eq('vendor_id', vendorData.id)
          .eq('status', 'delivered')
          .lt('delivered_at', twentyFourHoursAgo.toISOString());

        const commissionRate = vendorData.commission_rate || 15;
        const totalEligible = (eligibleOrders || []).reduce((sum, o) => {
          const subtotal = Number(o.subtotal);
          return sum + (subtotal - (subtotal * commissionRate / 100));
        }, 0);

        // Subtract already withdrawn/pending withdrawals
        const pendingWithdrawals = withdrawals
          .filter(w => w.status === 'pending' || w.status === 'processing')
          .reduce((sum, w) => sum + Number(w.amount), 0);

        setEligibleBalance(Math.max(0, totalEligible - (walletData?.total_withdrawn || 0) - pendingWithdrawals));
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
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
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > eligibleBalance) {
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
          userName: vendor?.name,
          amount,
          userType: 'vendor',
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

      // Process withdrawal
      const { error } = await supabase
        .from('withdrawal_requests')
        .insert({
          wallet_id: wallet!.id,
          user_id: user?.id,
          amount,
          bank_name: wallet!.bank_name,
          bank_account_number: wallet!.bank_account_number,
          bank_account_name: wallet!.bank_account_name || '',
          user_type: 'vendor',
        });

      if (error) throw error;

      toast({ title: 'Withdrawal request submitted', description: 'Your request will be processed within 24-48 hours.' });
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
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

  if (!hasPermission('request_withdrawal')) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor?.name} permissions={permissions} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied message="You don't have permission to request withdrawals." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} permissions={permissions} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Withdraw Funds</h1>
              <p className="text-muted-foreground">Manage your withdrawals and bank settings</p>
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

          {/* Dispute Notice */}
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">24-Hour Settlement Period</p>
                <p className="text-sm text-yellow-700">
                  For dispute protection, withdrawals are only available for orders delivered 24+ hours ago. 
                  This helps resolve any customer complaints or refund requests.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Eligible Balance</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(eligibleBalance)}</p>
                    <p className="text-xs text-muted-foreground">Available to withdraw</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Balance</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(wallet?.pending_balance || 0)}</p>
                    <p className="text-xs text-muted-foreground">Awaiting settlement</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-yellow-500" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Earned</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(wallet?.total_earned || 0)}</p>
                    <p className="text-xs text-muted-foreground">All-time earnings</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Withdrawn</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(wallet?.total_withdrawn || 0)}</p>
                    <p className="text-xs text-muted-foreground">Successfully withdrawn</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <ArrowUpRight className="w-6 h-6 text-accent" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Withdraw Button */}
          <Dialog open={withdrawDialogOpen} onOpenChange={handleCloseWithdrawDialog}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2">
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
                      max={eligibleBalance}
                    />
                    <p className="text-xs text-muted-foreground">
                      Eligible balance: {formatCurrency(eligibleBalance)}
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
                      Code sent to {user?.email}
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
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg">Withdrawal History</CardTitle>
              <CardDescription>Your recent withdrawal requests</CardDescription>
            </CardHeader>
            <CardContent>
              {withdrawals.length === 0 ? (
                <div className="text-center py-8">
                  <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No withdrawal requests yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {withdrawals.map((withdrawal) => (
                    <div
                      key={withdrawal.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
                    >
                      <div>
                        <p className="font-medium text-foreground">{formatCurrency(withdrawal.amount)}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(withdrawal.requested_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
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
        </div>
      </main>
    </div>
  );
}
