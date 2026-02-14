import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useToast } from '@/hooks/use-toast';
import { Check, X, CreditCard, Banknote, Clock, FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Requisition {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  category: string;
  bank_name: string | null;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  requested_by: string;
  requested_by_name: string;
  status: string;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  payment_method: string | null;
  paid_at: string | null;
  payment_note: string | null;
  environment: string;
  created_at: string;
}

interface Props {
  filter: 'pending' | 'all';
  onUpdate: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning border-warning/30',
  approved: 'bg-primary/10 text-primary border-primary/30',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
  paid: 'bg-success/10 text-success border-success/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

const CATEGORY_LABELS: Record<string, string> = {
  nin_verification: 'NIN Verification',
  office_supplies: 'Office Supplies',
  equipment: 'Equipment',
  marketing: 'Marketing',
  logistics: 'Logistics',
  maintenance: 'Maintenance',
  subscription: 'Subscriptions',
  utility: 'Utilities',
  general: 'General',
};

export function ExpenseRequisitionList({ filter, onUpdate }: Props) {
  const { user } = useAuth();
  const { isSuperAdmin, hasPermission } = useAdminPermissions();
  const { effectiveEnvironment } = useEnvironmentConfig();
  const { toast } = useToast();

  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);

  // Action dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<Requisition | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchRequisitions();
    
    const channel = supabase
      .channel('expense-requisitions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_requisitions' }, () => {
        fetchRequisitions();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filter, effectiveEnvironment]);

  const fetchRequisitions = async () => {
    let query = supabase
      .from('expense_requisitions')
      .select('*')
      .eq('environment', effectiveEnvironment)
      .order('created_at', { ascending: false });

    if (filter === 'pending') {
      query = query.in('status', ['pending', 'approved']);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching requisitions:', error);
    } else {
      setRequisitions((data as Requisition[]) || []);
    }
    setLoading(false);
  };

  const handleApprove = async (req: Requisition) => {
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('expense_requisitions')
        .update({
          status: 'approved',
          approved_by: user!.id,
          approved_by_name: user!.email || 'Admin',
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.id);

      if (error) throw error;
      toast({ title: 'Requisition approved' });
      onUpdate();
    } catch (e: any) {
      toast({ title: 'Failed to approve', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedReq) return;
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('expense_requisitions')
        .update({
          status: 'rejected',
          approved_by: user!.id,
          approved_by_name: user!.email || 'Admin',
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason || 'No reason provided',
        })
        .eq('id', selectedReq.id);

      if (error) throw error;
      toast({ title: 'Requisition rejected' });
      setRejectDialogOpen(false);
      setRejectionReason('');
      onUpdate();
    } catch (e: any) {
      toast({ title: 'Failed to reject', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handlePayViaPaystack = async (req: Requisition) => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-expense', {
        body: { requisition_id: req.id },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Payment failed');

      toast({ title: 'Payment initiated via Paystack', description: data.data?.message });
      onUpdate();
    } catch (e: any) {
      toast({ title: 'Payment failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!selectedReq) return;
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('expense_requisitions')
        .update({
          status: 'paid',
          payment_method: 'manual',
          paid_at: new Date().toISOString(),
          paid_by: user!.id,
          payment_note: paymentNote || 'Paid manually',
        })
        .eq('id', selectedReq.id);

      if (error) throw error;

      // Deduct from platform wallet
      const { data: platformWallet } = await supabase
        .from('platform_wallet')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (platformWallet) {
        await supabase.from('wallet_transactions').insert({
          wallet_type: 'platform',
          category: 'expense',
          transaction_type: 'debit',
          amount: selectedReq.amount,
          platform_wallet_id: platformWallet.id,
          environment: effectiveEnvironment,
          status: 'completed',
          notes: `Expense: ${selectedReq.title} (manual payment)`,
        });

        // Deduct from platform wallet balance
        const balanceCol = effectiveEnvironment === 'development' ? 'test_balance' : 'balance';
        const { data: currentWallet } = await supabase
          .from('platform_wallet')
          .select(balanceCol)
          .eq('id', platformWallet.id)
          .single();

        if (currentWallet) {
          const currentBalance = Number((currentWallet as Record<string, unknown>)[balanceCol]) || 0;
          await supabase
            .from('platform_wallet')
            .update({ [balanceCol]: Math.max(currentBalance - selectedReq.amount, 0), updated_at: new Date().toISOString() })
            .eq('id', platformWallet.id);
        }
      }

      toast({ title: 'Marked as paid' });
      setPayDialogOpen(false);
      setPaymentNote('');
      onUpdate();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (requisitions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No requisitions found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {requisitions.map(req => (
          <Card key={req.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground truncate">{req.title}</h3>
                    <Badge variant="outline" className={STATUS_COLORS[req.status]}>{req.status}</Badge>
                    <Badge variant="secondary" className="text-xs">{CATEGORY_LABELS[req.category] || req.category}</Badge>
                  </div>
                  {req.description && <p className="text-sm text-muted-foreground mb-2">{req.description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>By: {req.requested_by_name}</span>
                    <span>{format(new Date(req.created_at), 'MMM d, yyyy h:mm a')}</span>
                    {req.bank_name && <span>Bank: {req.bank_name}</span>}
                    {req.account_number && <span>Acct: {req.account_number}</span>}
                    {req.account_name && <span>Name: {req.account_name}</span>}
                  </div>
                  {req.rejection_reason && (
                    <p className="text-xs text-destructive mt-1">Reason: {req.rejection_reason}</p>
                  )}
                  {req.payment_note && (
                    <p className="text-xs text-muted-foreground mt-1">Payment note: {req.payment_note}</p>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-foreground">₦{req.amount.toLocaleString()}</p>

                  <div className="flex gap-2 mt-3 justify-end flex-wrap">
                    {req.status === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => handleApprove(req)} disabled={processing} className="gap-1">
                          <Check className="w-3 h-3" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => { setSelectedReq(req); setRejectDialogOpen(true); }}
                          disabled={processing}
                          className="gap-1"
                        >
                          <X className="w-3 h-3" /> Reject
                        </Button>
                      </>
                    )}
                    {req.status === 'approved' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handlePayViaPaystack(req)}
                          disabled={processing}
                          className="gap-1"
                        >
                          {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                          Pay via Paystack
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelectedReq(req); setPayDialogOpen(true); }}
                          disabled={processing}
                          className="gap-1"
                        >
                          <Banknote className="w-3 h-3" /> Mark Paid
                        </Button>
                      </>
                    )}
                    {req.status === 'paid' && (
                      <div className="flex items-center gap-1 text-xs text-success">
                        <Check className="w-3 h-3" />
                        {req.payment_method === 'paystack' ? 'Paid via Paystack' : 'Paid manually'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Requisition</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason for rejection</Label>
              <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Explain why..." />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={handleReject} disabled={processing} className="flex-1">
                {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark Paid Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Manual Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Mark <strong>₦{selectedReq?.amount.toLocaleString()}</strong> for "{selectedReq?.title}" as manually paid.
              This will deduct the amount from the platform wallet.
            </p>
            <div className="space-y-2">
              <Label>Payment Note (optional)</Label>
              <Textarea value={paymentNote} onChange={e => setPaymentNote(e.target.value)} placeholder="e.g. Paid via bank transfer ref #123" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setPayDialogOpen(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleMarkAsPaid} disabled={processing} className="flex-1">
                {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
