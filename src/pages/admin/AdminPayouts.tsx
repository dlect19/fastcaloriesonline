import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Banknote, Clock, CheckCircle, XCircle, Loader2, RefreshCw, User, Search, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { format } from 'date-fns';

interface PayoutRequest {
  id: string;
  user_id: string;
  user_type: string;
  amount: number;
  status: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  created_at: string;
  processed_at: string | null;
  failure_reason: string | null;
  paystack_reference: string | null;
  retry_count: number | null;
  withdrawal_source: string | null;
  wallet_id: string;
}

const isRetryableFailure = (reason: string | null): boolean => {
  if (!reason) return false;
  const lowerReason = reason.toLowerCase();
  return lowerReason.includes('balance') || 
         lowerReason.includes('insufficient') || 
         lowerReason.includes('not enough');
};

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-warning/10 text-warning', icon: Clock },
  processing: { label: 'Processing', color: 'bg-info/10 text-info', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-calorie-low/10 text-calorie-low', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-destructive/10 text-destructive', icon: XCircle },
};

export default function AdminPayouts() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, loading: authLoading } = useAdminPermissions();
  const { isTestMode, effectiveEnvironment, loading: envLoading } = useEnvironmentConfig();
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedPayout, setSelectedPayout] = useState<PayoutRequest | null>(null);
  const [dialogAction, setDialogAction] = useState<'approve' | 'reject' | 'retry' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => {
    if (!authLoading && !role) {
      navigate('/admin/auth');
      return;
    }
    if (role && !envLoading) {
      fetchPayouts();
    }
  }, [role, authLoading, envLoading, effectiveEnvironment, navigate]);

  const fetchPayouts = async () => {
    try {
      const { data, error } = await supabase
        .from('payout_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setPayouts(data || []);
    } catch (error) {
      console.error('Error fetching payouts:', error);
      toast({
        title: 'Error loading payouts',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedPayout) return;
    
    setProcessing(selectedPayout.id);
    try {
      const { data, error } = await supabase.functions.invoke('process-payout', {
        body: { payout_request_id: selectedPayout.id }
      });

      // Handle both error object and error in response body
      if (error) {
        throw new Error(error.message || 'Failed to process payout');
      }

      if (data?.success) {
        toast({ title: '✅ Payout approved and processed!' });
        fetchPayouts();
      } else {
        // Extract error message from response
        const errorMessage = data?.error || 'Failed to process payout';
        toast({
          title: 'Payout Failed',
          description: errorMessage,
          variant: 'destructive'
        });
        fetchPayouts(); // Refresh to show updated status
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        title: 'Error processing payout',
        description: errorMessage,
        variant: 'destructive'
      });
      fetchPayouts();
    } finally {
      setProcessing(null);
      setSelectedPayout(null);
      setDialogAction(null);
    }
  };

  const handleRetry = async () => {
    if (!selectedPayout) return;
    
    setProcessing(selectedPayout.id);
    try {
      // Reset status to pending and increment retry count
      const { error: updateError } = await supabase
        .from('payout_requests')
        .update({ 
          status: 'pending',
          failure_reason: null,
          retry_count: (selectedPayout.retry_count || 0) + 1
        })
        .eq('id', selectedPayout.id);

      if (updateError) throw updateError;

      // Now process the payout
      const { data, error } = await supabase.functions.invoke('process-payout', {
        body: { payout_request_id: selectedPayout.id }
      });

      // Handle both error object and error in response body
      if (error) {
        throw new Error(error.message || 'Failed to process payout');
      }

      if (data?.success) {
        toast({ title: '✅ Payout retry successful! Email sent to user.' });
        fetchPayouts();
      } else {
        // Extract error message from response
        const errorMessage = data?.error || 'Failed to process payout';
        toast({
          title: 'Retry Failed',
          description: errorMessage,
          variant: 'destructive'
        });
        fetchPayouts(); // Refresh to show updated status
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        title: 'Retry failed',
        description: errorMessage,
        variant: 'destructive'
      });
      fetchPayouts(); // Refresh to show updated status
    } finally {
      setProcessing(null);
      setSelectedPayout(null);
      setDialogAction(null);
    }
  };

  const handleReject = async () => {
    if (!selectedPayout) return;
    
    setProcessing(selectedPayout.id);
    try {
      // Update payout request status
      const { error } = await supabase
        .from('payout_requests')
        .update({ 
          status: 'failed',
          failure_reason: 'Rejected by admin',
          processed_at: new Date().toISOString()
        })
        .eq('id', selectedPayout.id);

      if (error) throw error;

      // CRITICAL: Return funds to the vendor's source-specific pool
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('id', selectedPayout.wallet_id)
        .single();

      if (wallet) {
        const amount = Number(selectedPayout.amount);
        const source = selectedPayout.withdrawal_source || 'menu_earnings';
        const updateFields: Record<string, number> = {};
        
        // Restore to the correct source pool
        if (source === 'rider_revenue') {
          updateFields.rider_revenue_balance = (Number(wallet.rider_revenue_balance) || 0) + amount;
        } else {
          updateFields.menu_earnings_balance = (Number(wallet.menu_earnings_balance) || 0) + amount;
        }
        
        // Restore general balances
        updateFields.eligible_balance = (Number(wallet.eligible_balance) || 0) + amount;
        updateFields.balance = (Number(wallet.balance) || 0) + amount;
        updateFields.pending_payouts = Math.max(0, (Number(wallet.pending_payouts) || 0) - amount);

        await supabase
          .from('wallets')
          .update(updateFields)
          .eq('id', wallet.id);

        // Log the reversal transaction
        await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          wallet_type: 'vendor',
          transaction_type: 'credit',
          category: source === 'rider_revenue' ? 'vendor_rider_share' : 'vendor_share',
          amount: amount,
          status: 'completed',
          environment: isTestMode ? 'development' : 'production',
          notes: `Withdrawal rejected by admin - funds returned to ${source === 'rider_revenue' ? 'rider revenue' : 'menu earnings'}`,
        });
      }

      toast({ title: 'Payout rejected and funds returned to vendor' });
      fetchPayouts();
    } catch (error: any) {
      toast({
        title: 'Error rejecting payout',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(null);
      setSelectedPayout(null);
      setDialogAction(null);
    }
  };

  // Apply search and date filters
  const filteredPayouts = payouts.filter(p => {
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesName = (p.bank_account_name || '').toLowerCase().includes(q);
      const matchesBank = (p.bank_name || '').toLowerCase().includes(q);
      const matchesRef = (p.paystack_reference || '').toLowerCase().includes(q);
      if (!matchesName && !matchesBank && !matchesRef) return false;
    }
    // Date range filter
    if (dateRange.from) {
      if (new Date(p.created_at) < dateRange.from) return false;
    }
    if (dateRange.to) {
      const endOfDay = new Date(dateRange.to);
      endOfDay.setHours(23, 59, 59, 999);
      if (new Date(p.created_at) > endOfDay) return false;
    }
    return true;
  });

  const pendingPayouts = filteredPayouts.filter(p => p.status === 'pending');
  const processingPayouts = filteredPayouts.filter(p => p.status === 'processing');
  const completedPayouts = filteredPayouts.filter(p => p.status === 'completed');
  const failedPayouts = filteredPayouts.filter(p => p.status === 'failed');

  const renderPayoutCard = (payout: PayoutRequest) => {
    const status = statusConfig[payout.status] || statusConfig.pending;
    const StatusIcon = status.icon;

    return (
      <Card key={payout.id}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">{payout.bank_account_name || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground capitalize">{payout.user_type}</p>
                {payout.withdrawal_source && (
                  <Badge variant="outline" className="text-xs mt-0.5">
                    {payout.withdrawal_source === 'rider_revenue' ? 'Rider Revenue' : 'Menu Earnings'}
                  </Badge>
                )}
              </div>
            </div>
            <Badge className={`${status.color} border-0`}>
              <StatusIcon className={`w-3 h-3 mr-1 ${payout.status === 'processing' ? 'animate-spin' : ''}`} />
              {status.label}
            </Badge>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold text-foreground">₦{Number(payout.amount).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bank</span>
              <span className="text-foreground">{payout.bank_name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account</span>
              <span className="text-foreground">{payout.bank_account_number || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Requested</span>
              <span className="text-foreground">{format(new Date(payout.created_at), 'PP p')}</span>
            </div>
            {payout.processed_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Processed</span>
                <span className="text-foreground">{format(new Date(payout.processed_at), 'PP p')}</span>
              </div>
            )}
            {payout.failure_reason && (
              <div className="pt-2 border-t">
                <p className="text-destructive text-xs">{payout.failure_reason}</p>
                {payout.retry_count && payout.retry_count > 0 && (
                  <p className="text-muted-foreground text-xs mt-1">Retry attempts: {payout.retry_count}</p>
                )}
              </div>
            )}
            {payout.paystack_reference && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="text-xs font-mono text-foreground">{payout.paystack_reference}</span>
              </div>
            )}
          </div>

          {payout.status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button 
                size="sm" 
                className="flex-1"
                onClick={() => {
                  setSelectedPayout(payout);
                  setDialogAction('approve');
                }}
                disabled={processing === payout.id}
              >
                {processing === payout.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Approve'
                )}
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                className="flex-1 text-destructive hover:text-destructive"
                onClick={() => {
                  setSelectedPayout(payout);
                  setDialogAction('reject');
                }}
                disabled={processing === payout.id}
              >
                Reject
              </Button>
            </div>
          )}

          {payout.status === 'failed' && (
            <div className="mt-4">
              <Button 
                size="sm" 
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedPayout(payout);
                  setDialogAction('retry');
                }}
                disabled={processing === payout.id}
              >
                {processing === payout.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Retry Payout
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (authLoading || loading || envLoading) {
    return (
      <div className="min-h-screen bg-background flex">
        <AdminSidebar />
        <main className="flex-1 lg:ml-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const totalPending = pendingPayouts.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalProcessed = completedPayouts.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      <main className="flex-1 lg:ml-0">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Payout Management</h1>
              <p className="text-muted-foreground">
                Approve or reject withdrawal requests
                {isTestMode && " • Showing test mode payouts only"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className={isTestMode 
                  ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" 
                  : "bg-green-500/10 text-green-600 border-green-500/30"
                }
              >
                {isTestMode ? 'Test Mode' : 'Live Mode'}
              </Badge>
              <Button variant="outline" size="icon" onClick={fetchPayouts}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Search & Date Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, bank, reference..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="w-8 h-8 mx-auto text-warning mb-2" />
                <p className="text-2xl font-bold text-foreground">{pendingPayouts.length}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Banknote className="w-8 h-8 mx-auto text-warning mb-2" />
                <p className="text-2xl font-bold text-foreground">₦{totalPending.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Pending Amount</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <CheckCircle className="w-8 h-8 mx-auto text-calorie-low mb-2" />
                <p className="text-2xl font-bold text-foreground">{completedPayouts.length}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Banknote className="w-8 h-8 mx-auto text-calorie-low mb-2" />
                <p className="text-2xl font-bold text-foreground">₦{totalProcessed.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Paid Out</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">
                Pending ({pendingPayouts.length})
              </TabsTrigger>
              <TabsTrigger value="processing">
                Processing ({processingPayouts.length})
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed ({completedPayouts.length})
              </TabsTrigger>
              <TabsTrigger value="failed">
                Failed ({failedPayouts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="mt-4">
              {pendingPayouts.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No pending payout requests</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pendingPayouts.map(renderPayoutCard)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="processing" className="mt-4">
              {processingPayouts.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Loader2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No payouts being processed</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {processingPayouts.map(renderPayoutCard)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed" className="mt-4">
              {completedPayouts.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <CheckCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No completed payouts yet</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {completedPayouts.map(renderPayoutCard)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="failed" className="mt-4">
              {failedPayouts.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <XCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No failed payouts</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {failedPayouts.map(renderPayoutCard)}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Confirmation Dialogs */}
      <AlertDialog open={dialogAction === 'approve'} onOpenChange={() => setDialogAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Payout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will transfer ₦{Number(selectedPayout?.amount || 0).toLocaleString()} to {selectedPayout?.bank_account_name}'s account at {selectedPayout?.bank_name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove}>
              Approve & Process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialogAction === 'reject'} onOpenChange={() => setDialogAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Payout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reject the payout request for ₦{Number(selectedPayout?.amount || 0).toLocaleString()}. The funds will remain in the user's wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Reject Payout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialogAction === 'retry'} onOpenChange={() => setDialogAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry Payout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will retry the transfer of ₦{Number(selectedPayout?.amount || 0).toLocaleString()} to {selectedPayout?.bank_account_name}'s account. 
              Make sure your Paystack balance is sufficient before retrying.
              {selectedPayout?.retry_count && selectedPayout.retry_count > 0 && (
                <span className="block mt-2 text-warning">This payout has been retried {selectedPayout.retry_count} time(s) already.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetry}>
              Retry Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
