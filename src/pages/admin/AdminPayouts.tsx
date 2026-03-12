import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
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
  paystack_transfer_code: string | null;
  retry_count: number | null;
  withdrawal_source: string | null;
  wallet_id: string;
  entity_name?: string;
  entity_phone?: string;
  entity_email?: string;
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
  const [dialogAction, setDialogAction] = useState<'approve' | 'reject' | 'retry' | 'mark_completed' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [verifying, setVerifying] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !role) {
      navigate('/admin/auth');
      return;
    }
    if (role && !envLoading) {
      fetchPayouts();
    }
  }, [role, authLoading, envLoading, effectiveEnvironment, navigate]);

  // Auto-verify processing payouts on load
  const autoVerifyProcessing = async (payoutsList: PayoutRequest[]) => {
    const processingPayouts = payoutsList.filter(
      p => p.status === 'processing' && (p.paystack_reference || p.paystack_transfer_code)
    );
    
    if (processingPayouts.length === 0) return;

    for (const payout of processingPayouts) {
      try {
        const { data } = await supabase.functions.invoke('verify-transfer-status', {
          body: { payout_request_id: payout.id }
        });
        if (data?.success && data?.data?.updated) {
          console.log(`Auto-verified payout ${payout.id}: ${data.data.new_status}`);
        }
      } catch (err) {
        console.error('Auto-verify failed for', payout.id, err);
      }
    }
    
    // Refresh if any were updated
    if (processingPayouts.length > 0) {
      fetchPayouts(true);
    }
  };

  const handleVerifyStatus = async (payout: PayoutRequest) => {
    setVerifying(payout.id);
    try {
      const { data, error } = await supabase.functions.invoke('verify-transfer-status', {
        body: { payout_request_id: payout.id }
      });

      if (error) throw new Error(error.message);

      if (data?.success) {
        if (data.data.updated) {
          toast({ title: `✅ Status updated to: ${data.data.new_status}` });
          fetchPayouts(true);
        } else {
          toast({ title: `Transfer status: ${data.data.paystack_status}`, description: 'No update needed.' });
        }
      } else {
        toast({ title: 'Verification failed', description: data?.error, variant: 'destructive' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Verification error', description: msg, variant: 'destructive' });
    } finally {
      setVerifying(null);
    }
  };

  const fetchPayouts = async (skipAutoVerify = false) => {
    try {
      const { data, error } = await supabase
        .from('payout_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const requests = data || [];
      const userIds = [...new Set(requests.map(p => p.user_id))];
      
      if (userIds.length > 0) {
        // Fetch vendor names, delivery company names, and profile names in parallel
        const [vendorsRes, companiesRes, profilesRes, riderProfilesRes] = await Promise.all([
          supabase.from('vendors').select('user_id, name, phone, email').in('user_id', userIds),
          supabase.from('delivery_companies').select('user_id, name, phone, email').in('user_id', userIds),
          supabase.from('profiles').select('user_id, full_name, phone').in('user_id', userIds),
          supabase.from('rider_profiles').select('user_id, email').in('user_id', userIds),
        ]);

        const vendorMap = new Map((vendorsRes.data || []).map(v => [v.user_id, v]));
        const companyMap = new Map((companiesRes.data || []).map(c => [c.user_id, c]));
        const profileMap = new Map((profilesRes.data || []).map(p => [p.user_id, p]));
        const riderEmailMap = new Map((riderProfilesRes.data || []).map(r => [r.user_id, r.email]));

        const enriched = requests.map(p => {
          const vendor = vendorMap.get(p.user_id);
          const company = companyMap.get(p.user_id);
          const profile = profileMap.get(p.user_id);
          const riderEmail = riderEmailMap.get(p.user_id);

          let entity_name: string | null = null;
          let entity_phone = '';
          let entity_email = '';

          if (p.user_type === 'vendor' && vendor) {
            entity_name = vendor.name;
            entity_phone = profile?.phone || vendor.phone || '';
            entity_email = vendor.email || '';
          } else if (p.user_type === 'delivery_company' && company) {
            entity_name = company.name;
            entity_phone = company.phone || '';
            entity_email = company.email || '';
          } else {
            entity_name = profile?.full_name || null;
            entity_phone = profile?.phone || '';
            entity_email = riderEmail || '';
          }

          return { ...p, entity_name, entity_phone, entity_email };
        });
        
        setPayouts(enriched);
        if (!skipAutoVerify) autoVerifyProcessing(enriched);
      } else {
        setPayouts(requests);
      }
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
        const isCompleted = data?.data?.status === 'completed';
        toast({ 
          title: isCompleted 
            ? '✅ Payout completed successfully!' 
            : '⏳ Payout approved and processing...',
          description: data?.data?.message
        });
        fetchPayouts();
      } else {
        const errorMessage = data?.error || 'Failed to process payout';
        toast({
          title: 'Payout Failed',
          description: errorMessage,
          variant: 'destructive'
        });
        fetchPayouts();
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

  const handleMarkCompleted = async () => {
    if (!selectedPayout) return;
    
    setProcessing(selectedPayout.id);
    try {
      const { error } = await supabase
        .from('payout_requests')
        .update({ 
          status: 'completed',
          processed_at: new Date().toISOString(),
          failure_reason: null,
        })
        .eq('id', selectedPayout.id);

      if (error) throw error;

      toast({ title: '✅ Payout marked as completed!' });
      fetchPayouts();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error updating payout', description: errorMessage, variant: 'destructive' });
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

      // NOTE: Wallet balance restoration and withdrawal_reversal transaction
      // are handled automatically by the 'restore_wallet_on_payout_failure' 
      // database trigger when payout status changes to 'failed'.
      // Do NOT manually update wallet or insert transactions here to avoid
      // double-crediting.

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
      const matchesEntity = (p.entity_name || '').toLowerCase().includes(q);
      const matchesBank = (p.bank_name || '').toLowerCase().includes(q);
      const matchesRef = (p.paystack_reference || '').toLowerCase().includes(q);
      if (!matchesName && !matchesEntity && !matchesBank && !matchesRef) return false;
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
                <p className="font-medium text-foreground">{payout.entity_name || payout.bank_account_name || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground capitalize">{payout.user_type}{payout.entity_name && payout.bank_account_name && payout.entity_name !== payout.bank_account_name ? ` · ${payout.bank_account_name}` : ''}</p>
                {(payout.entity_phone || payout.entity_email) && (
                  <p className="text-xs text-muted-foreground">
                    {[payout.entity_phone, payout.entity_email].filter(Boolean).join(' • ')}
                  </p>
                )}
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

          {payout.status === 'processing' && (
            <div className="mt-4 flex gap-2">
              <Button 
                size="sm" 
                variant="outline"
                className="flex-1"
                onClick={() => handleVerifyStatus(payout)}
                disabled={verifying === payout.id || processing === payout.id}
              >
                {verifying === payout.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Verify Status
              </Button>
              <Button 
                size="sm" 
                variant="default"
                className="flex-1 bg-success hover:bg-success/90"
                onClick={() => {
                  setSelectedPayout(payout);
                  setDialogAction('mark_completed');
                }}
                disabled={processing === payout.id}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Mark Completed
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
      <AdminLayout>
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          </div>
      </AdminLayout>
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
              <Button variant="outline" size="icon" onClick={() => fetchPayouts()}>
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

      <AlertDialog open={dialogAction === 'mark_completed'} onOpenChange={() => setDialogAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Completed?</AlertDialogTitle>
            <AlertDialogDescription>
              This will manually mark the payout of ₦{Number(selectedPayout?.amount || 0).toLocaleString()} to {selectedPayout?.bank_account_name} as completed. 
              Only use this if you've confirmed the transfer was successful via your payment provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkCompleted} className="bg-success hover:bg-success/90">
              Confirm Completed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
