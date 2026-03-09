import { useState, useEffect, useMemo } from 'react';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wallet, ArrowUpRight, Building2, CreditCard, Clock, Settings, AlertCircle, Loader2, ShieldCheck, FlaskConical, AlertTriangle, Bike, UtensilsCrossed } from 'lucide-react';
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
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { BankAccountForm } from '@/components/BankAccountForm';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';
import { PaginationControls } from '@/components/shared/PaginationControls';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;

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
  // Separated revenue pools
  menu_earnings_balance: number;
  menu_earnings_pending: number;
  rider_revenue_balance: number;
}

type WithdrawalSource = 'menu_earnings' | 'rider_revenue';

interface WithdrawalRequest {
  id: string;
  amount: number;
  status: string;
  requested_at: string;
  processed_at: string | null;
  notes: string | null;
  withdrawal_source: string;
}

interface RecipientData {
  created_in_environment: string | null;
}

export default function VendorWithdraw() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedOutletId, setSelectedOutletId, ready: outletReady } = usePersistedOutletId();
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Withdrawal source selection
  const [withdrawalSource, setWithdrawalSource] = useState<WithdrawalSource>('menu_earnings');
  
  // OTP verification state
  const [otpStep, setOtpStep] = useState<'amount' | 'otp'>('amount');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [recipientEnvironment, setRecipientEnvironment] = useState<string | null>(null);
  const [withdrawalPage, setWithdrawalPage] = useState(1);
  const W_PER_PAGE = 10;
  const [settlementHours, setSettlementHours] = useState<number | null>(null);

  // Bank details form
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  // Auto-withdraw settings
  const [autoWithdraw, setAutoWithdraw] = useState(false);
  const [autoWithdrawThreshold, setAutoWithdrawThreshold] = useState('5000');
  const [autoWithdrawDay, setAutoWithdrawDay] = useState('1');

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);
  
  // Initialize withdrawal source from URL params
  useEffect(() => {
    const sourceParam = searchParams.get('source');
    if (sourceParam === 'rider_revenue' || sourceParam === 'menu_earnings') {
      setWithdrawalSource(sourceParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (!outletReady) return;
    if (user && selectedOutletId) {
      fetchData();
    } else if (user && !selectedOutletId) {
      setLoading(false);
    }
  }, [user, authLoading, navigate, isTestMode, selectedOutletId, outletReady]);

  const fetchData = async () => {
    try {
      // First check if user is a vendor owner
      let vendorData = null;
      const { data: ownedVendor } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
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
            .select('*')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      const vendorOwnerId = vendorData?.user_id;
      if (!vendorOwnerId || !selectedOutletId) {
        setWallet(null);
        setWithdrawals([]);
        setAllTransactions([]);
        return;
      }

      // Fetch selected outlet wallet
      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', vendorOwnerId)
        .eq('wallet_type', 'vendor')
        .eq('outlet_id', selectedOutletId)
        .maybeSingle();

      if (walletData) {
        // Use test columns if in test mode, otherwise production columns
        const balance = isTestMode 
          ? Number(walletData.test_balance) || 0 
          : Number(walletData.balance) || 0;
        const pendingBal = isTestMode 
          ? Number(walletData.test_pending_balance) || 0 
          : Number(walletData.pending_balance) || 0;
        
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
          ...walletData,
          balance: balance,
          pending_balance: pendingBal,
          pending_payouts: Number(walletData.pending_payouts) || 0,
          menu_earnings_balance: menuEarningsBalance,
          menu_earnings_pending: menuEarningsPending,
          rider_revenue_balance: riderRevenueBalance,
        } as WalletData);
        
        setBankName(walletData.bank_name || '');
        setAccountNumber(walletData.bank_account_number || '');
        setAccountName(walletData.bank_account_name || '');
        setAutoWithdraw(walletData.auto_withdraw || false);
        setAutoWithdrawThreshold(String(walletData.auto_withdraw_threshold || 5000));
        setAutoWithdrawDay(String(walletData.auto_withdraw_day || 1));

        // Fetch ALL transactions for ledger-based balance computation
        const env = isTestMode ? 'development' : 'production';
        const { data: allTxData } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .eq('environment', env);

        if (allTxData) {
          setAllTransactions(allTxData);
        }

        // Fetch withdrawal requests from unified payout_requests table
        const { data: payoutData } = await supabase
          .from('payout_requests')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(20);

        // Map to expected format with withdrawal_source tag
        setWithdrawals((payoutData || []).map(p => ({
          id: p.id,
          amount: Number(p.amount),
          status: p.status || 'pending',
          requested_at: p.created_at || '',
          processed_at: p.processed_at,
          notes: p.failure_reason,
          withdrawal_source: (p as any).withdrawal_source || 'menu_earnings',
        })));

        // Fetch recipient environment info
        const { data: recipientData } = await supabase
          .from('paystack_recipients')
          .select('created_in_environment')
          .eq('user_id', vendorOwnerId)
          .eq('is_default', true)
          .maybeSingle();
        
        setRecipientEnvironment(recipientData?.created_in_environment || null);
      }

      // Fetch settlement hours based on vendor category
      if (vendorData?.category) {
        const categoryKey = `settlement_hours_${vendorData.category.toLowerCase()}`;
        const { data: settlementData } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', categoryKey)
          .maybeSingle();
        
        setSettlementHours(settlementData ? Number(settlementData.value) : 24);
      } else {
        setSettlementHours(24);
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

  // Build a set of withdrawal transaction IDs that came from rider_revenue payouts
  const riderRevenueWithdrawalTxIds = useMemo(() => {
    const riderPayoutWalletIds = new Set(
      withdrawals
        .filter(w => w.withdrawal_source === 'rider_revenue')
        .map(w => w.id)
    );
    // Match withdrawal transactions by checking if their amount+timing aligns with rider_revenue payouts
    // But more reliably, check notes for "Rider Revenue" OR if not tagged, fall back to payout source
    return new Set<string>();
  }, [withdrawals]);

  // Helper: determine if a withdrawal transaction is for rider revenue
  const isRiderRevenueWithdrawal = (tx: any) => {
    if (tx.notes?.includes('Rider Revenue')) return true;
    if (tx.notes?.includes('Menu Earnings')) return false;
    // If notes don't specify, check against payout_requests by amount match
    return false;
  };

  // Compute balances from ledger (source of truth) - same logic as VendorEarnings
  const computedMenuBalance = Math.max(0, allTransactions
    .reduce((sum: number, tx: any) => {
      if (tx.category === 'vendor_share' && tx.status === 'completed') {
        return tx.transaction_type === 'credit' ? sum + Number(tx.amount) : sum - Number(tx.amount);
      }
      if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && !isRiderRevenueWithdrawal(tx)) {
        return sum - Number(tx.amount);
      }
      if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && !isRiderRevenueWithdrawal(tx)) {
        return sum + Number(tx.amount);
      }
      // Handle admin debits/credits for menu earnings
      if (tx.category === 'admin_debit' && tx.transaction_type === 'debit') {
        return sum - Number(tx.amount);
      }
      if (tx.category === 'admin_credit' && tx.transaction_type === 'credit') {
        return sum + Number(tx.amount);
      }
      return sum;
    }, 0));

  const computedMenuPending = Math.max(0, allTransactions
    .filter((tx: any) => tx.category === 'vendor_share' && tx.transaction_type === 'credit' && tx.status === 'pending')
    .reduce((sum: number, tx: any) => sum + Number(tx.amount), 0));

  const computedRiderBalance = Math.max(0, allTransactions
    .reduce((sum: number, tx: any) => {
      if (tx.category === 'vendor_rider_share' && tx.status === 'completed') {
        return tx.transaction_type === 'credit' ? sum + Number(tx.amount) : sum - Number(tx.amount);
      }
      if (tx.category === 'withdrawal' && tx.transaction_type === 'debit' && isRiderRevenueWithdrawal(tx)) {
        return sum - Number(tx.amount);
      }
      if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit' && isRiderRevenueWithdrawal(tx)) {
        return sum + Number(tx.amount);
      }
      return sum;
    }, 0));

  // Display uses ledger-computed values (consistent with Earnings page)
  // Withdrawal validation uses min(ledger, DB) to prevent over-withdrawal
  const dbMenuBalance = wallet?.menu_earnings_balance ?? 0;
  const dbRiderBalance = wallet?.rider_revenue_balance ?? 0;
  
  // Use ledger values for display (same as Earnings page shows)
  const displayMenuBalance = computedMenuBalance;
  const displayRiderBalance = computedRiderBalance;
  
  // For withdrawal: use the minimum of ledger and DB to be safe
  const safeMenuBalance = Math.min(computedMenuBalance, dbMenuBalance);
  const safeRiderBalance = Math.min(computedRiderBalance, dbRiderBalance);

  // Track pending withdrawals for display, but don't block new ones
  const hasPendingWithdrawal = withdrawals.some(
    w => w.status === 'pending' || w.status === 'processing'
  );

  const handleRequestOTP = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    // Get the correct eligible balance based on source (use safe balance = min of ledger & DB)
    const sourceBalance = withdrawalSource === 'rider_revenue' 
      ? safeRiderBalance
      : safeMenuBalance;

    if (amount > sourceBalance) {
      toast({ title: `Amount exceeds ${withdrawalSource === 'rider_revenue' ? 'rider revenue' : 'menu earnings'} balance`, variant: 'destructive' });
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

      // CRITICAL: Re-check balance server-side to prevent race conditions
      const { data: freshWallet } = await supabase
        .from('wallets')
        .select('menu_earnings_balance, rider_revenue_balance, test_menu_earnings_balance, test_rider_revenue_balance, eligible_balance, test_eligible_balance, balance, test_balance, pending_payouts')
        .eq('id', wallet!.id)
        .single();

      if (!freshWallet) throw new Error('Wallet not found');

      const freshSourceBalance = withdrawalSource === 'rider_revenue'
        ? (isTestMode ? Number(freshWallet.test_rider_revenue_balance) : Number(freshWallet.rider_revenue_balance)) || 0
        : (isTestMode ? Number(freshWallet.test_menu_earnings_balance) : Number(freshWallet.menu_earnings_balance)) || 0;

      if (amount > freshSourceBalance) {
        throw new Error('Insufficient balance. Your available balance may have changed.');
      }

      // Process withdrawal - insert into unified payout_requests table with source tag
      const { data: insertedPayout, error } = await supabase
        .from('payout_requests')
          .insert({
            wallet_id: wallet!.id,
            user_id: user?.id,
            outlet_id: selectedOutletId,
            amount,
            bank_name: wallet!.bank_name,
            bank_account_number: wallet!.bank_account_number,
            bank_account_name: wallet!.bank_account_name || '',
            user_type: 'vendor',
            status: 'pending',
            withdrawal_source: withdrawalSource,
          })
        .select('id')
        .single();

      if (error) throw error;

      // Balance deduction is now handled by database trigger (deduct_wallet_on_payout_request)

      // Check if auto-approval is enabled
      const { data: approvalSetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'payout_approval_mode')
        .single();

      if (approvalSetting?.value === 'auto' && insertedPayout?.id) {
        toast({ title: 'Processing withdrawal...', description: 'Auto-approval is enabled. Processing your payout now.' });
        try {
          const { data: payoutResult, error: payoutError } = await supabase.functions.invoke('process-payout', {
            body: { payout_request_id: insertedPayout.id }
          });
          if (payoutError || !payoutResult?.success) {
            toast({ title: 'Payout queued', description: payoutResult?.error || 'Payout will be retried by admin.', variant: 'destructive' });
          } else {
            toast({ title: '✅ Withdrawal processing', description: payoutResult?.data?.message || 'Your payout is being processed.' });
          }
        } catch {
          toast({ title: 'Payout queued', description: 'Auto-processing encountered an issue. Admin will review.' });
        }
      } else {
        toast({ title: 'Withdrawal request submitted', description: 'Your request is pending admin approval.' });
      }
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

  if (authLoading || loading || permLoading || !outletReady) {
    return (
      <VendorLayout onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </VendorLayout>
    );
  }

  if (!hasPermission('request_withdrawal')) {
    return (
      <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <AccessDenied message="You don't have permission to request withdrawals." />
      </VendorLayout>
    );
  }

  return (
    <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
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
            <Card className="border-destructive bg-destructive/10">
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

          {/* Dispute Notice - only show if settlement period > 0 */}
          {settlementHours !== null && settlementHours > 0 && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800">{settlementHours}-Hour Settlement Period</p>
                  <p className="text-sm text-yellow-700">
                    For dispute protection, withdrawals are only available for orders delivered {settlementHours}+ hours ago. 
                    This helps resolve any customer complaints or refund requests.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revenue Pool Selection Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Menu Sales Revenue */}
            <Card 
              className={`border-2 cursor-pointer transition-all ${
                withdrawalSource === 'menu_earnings' 
                  ? 'border-primary bg-primary/5' 
                  : 'border-transparent hover:border-muted-foreground/30'
              }`}
              onClick={() => setWithdrawalSource('menu_earnings')}
            >
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
                      {formatCurrency(displayMenuBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                    <p className="text-xl font-bold text-warning">
                      {formatCurrency(computedMenuPending)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Rider Delivery Revenue */}
            <Card 
              className={`border-2 cursor-pointer transition-all ${
                withdrawalSource === 'rider_revenue' 
                  ? 'border-accent bg-accent/5' 
                  : 'border-transparent hover:border-muted-foreground/30'
              }`}
              onClick={() => setWithdrawalSource('rider_revenue')}
            >
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
                      {formatCurrency(displayRiderBalance)}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center">
                    <p className="text-sm text-muted-foreground">No Hold Period</p>
                    <p className="text-xs text-muted-foreground">Available immediately</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Combined Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Pending</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(wallet?.pending_balance || 0)}</p>
                    <p className="text-xs text-muted-foreground">
                      {settlementHours !== null && settlementHours > 0 
                        ? `Menu sales (${settlementHours}hr hold)` 
                        : 'Menu sales (no hold)'}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Withdraw Pending Card */}
            {(wallet?.pending_payouts || 0) > 0 && (
              <Card className="border-2 border-blue-200 bg-blue-50/50">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600 font-medium">Withdraw Pending</p>
                      <p className="text-2xl font-bold text-blue-700">{formatCurrency(wallet?.pending_payouts || 0)}</p>
                      <p className="text-xs text-blue-500">Awaiting admin approval</p>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

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

          {/* Pending Withdrawal Info */}
          {hasPendingWithdrawal && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-800">Withdrawal In Progress</p>
                  <p className="text-sm text-blue-700">
                    You have a pending or processing withdrawal. You can still submit additional requests if you have sufficient balance.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Withdraw Button */}
          <Dialog open={withdrawDialogOpen} onOpenChange={handleCloseWithdrawDialog}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2">
                <ArrowUpRight className="w-5 h-5" />
                Withdraw {withdrawalSource === 'rider_revenue' ? 'Rider Revenue' : 'Menu Earnings'}
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
                    ? `Withdraw ${withdrawalSource === 'rider_revenue' ? 'rider delivery revenue' : 'menu sales earnings'} to your bank account` 
                    : 'Enter the 6-digit code sent to your email'}
                </DialogDescription>
              </DialogHeader>
              
              {otpStep === 'amount' ? (
                <div className="space-y-4">
                  {/* Source Badge */}
                  <div className={`p-3 rounded-lg flex items-center gap-2 ${
                    withdrawalSource === 'rider_revenue' 
                      ? 'bg-accent/10' 
                      : 'bg-primary/10'
                  }`}>
                    {withdrawalSource === 'rider_revenue' ? (
                      <Bike className="w-5 h-5 text-accent" />
                    ) : (
                      <UtensilsCrossed className="w-5 h-5 text-primary" />
                    )}
                    <span className="font-medium">
                      {withdrawalSource === 'rider_revenue' ? 'Rider Delivery Revenue' : 'Menu Sales Revenue'}
                    </span>
                  </div>

                  {wallet?.bank_name ? (
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">Withdrawing to:</p>
                      <p className="font-medium">{wallet.bank_name}</p>
                      <p className="text-sm">{wallet.bank_account_number} - {wallet.bank_account_name}</p>
                    </div>
                  ) : (
                    <div className="p-4 bg-warning/10 rounded-lg text-center">
                      <p className="text-sm text-warning">Please add bank details first</p>
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
                      max={withdrawalSource === 'rider_revenue' 
                        ? displayRiderBalance 
                        : displayMenuBalance}
                    />
                    <p className="text-xs text-muted-foreground">
                      Available: {formatCurrency(
                        withdrawalSource === 'rider_revenue' 
                          ? displayRiderBalance 
                          : displayMenuBalance
                      )}
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
                  {withdrawals.slice((withdrawalPage - 1) * W_PER_PAGE, withdrawalPage * W_PER_PAGE).map((withdrawal) => (
                    <div
                      key={withdrawal.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          withdrawal.withdrawal_source === 'rider_revenue' 
                            ? 'bg-accent/10' 
                            : 'bg-primary/10'
                        }`}>
                          {withdrawal.withdrawal_source === 'rider_revenue' ? (
                            <Bike className="w-5 h-5 text-accent" />
                          ) : (
                            <UtensilsCrossed className="w-5 h-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{formatCurrency(withdrawal.amount)}</p>
                          <p className="text-sm text-muted-foreground">
                            {withdrawal.withdrawal_source === 'rider_revenue' ? 'Rider Revenue' : 'Menu Earnings'} • {new Date(withdrawal.requested_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                          </p>
                        </div>
                      </div>
                      <Badge className={getStatusColor(withdrawal.status)}>
                        {withdrawal.status}
                      </Badge>
                    </div>
                  ))}
                  <PaginationControls
                    currentPage={withdrawalPage}
                    totalPages={Math.ceil(withdrawals.length / W_PER_PAGE)}
                    onPageChange={setWithdrawalPage}
                    totalItems={withdrawals.length}
                    itemsPerPage={W_PER_PAGE}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </VendorLayout>
  );
}
