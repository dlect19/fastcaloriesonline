import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Banknote, Clock, CheckCircle, XCircle, Loader2, RefreshCw, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
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
}

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
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedPayout, setSelectedPayout] = useState<PayoutRequest | null>(null);
  const [dialogAction, setDialogAction] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    if (!authLoading && !role) {
      navigate('/admin/auth');
      return;
    }
    if (role) {
      fetchPayouts();
    }
  }, [role, authLoading, navigate]);

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

      if (error) throw error;

      if (data?.success) {
        toast({ title: '✅ Payout approved and processed!' });
        fetchPayouts();
      } else {
        throw new Error(data?.error || 'Failed to process payout');
      }
    } catch (error: any) {
      toast({
        title: 'Error processing payout',
        description: error.message,
        variant: 'destructive'
      });
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
      const { error } = await supabase
        .from('payout_requests')
        .update({ 
          status: 'failed',
          failure_reason: 'Rejected by admin',
          processed_at: new Date().toISOString()
        })
        .eq('id', selectedPayout.id);

      if (error) throw error;

      toast({ title: 'Payout rejected' });
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

  const pendingPayouts = payouts.filter(p => p.status === 'pending');
  const processingPayouts = payouts.filter(p => p.status === 'processing');
  const completedPayouts = payouts.filter(p => p.status === 'completed');
  const failedPayouts = payouts.filter(p => p.status === 'failed');

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
        </CardContent>
      </Card>
    );
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <AdminSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
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
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Payout Management</h1>
              <p className="text-muted-foreground">Approve or reject withdrawal requests</p>
            </div>
            <Button variant="outline" size="icon" onClick={fetchPayouts}>
              <RefreshCw className="w-4 h-4" />
            </Button>
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
    </div>
  );
}
