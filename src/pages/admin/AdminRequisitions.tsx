import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ExpenseRequisitionForm } from '@/components/admin/expenses/ExpenseRequisitionForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Plus, FileText, Clock, CheckCircle, XCircle, CreditCard } from 'lucide-react';

interface MyRequisition {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  category: string;
  status: string;
  bank_name: string | null;
  account_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  payment_method: string | null;
  paid_at: string | null;
  payment_note: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: 'bg-warning/10 text-warning border-warning/30', icon: Clock, label: 'Pending' },
  approved: { color: 'bg-primary/10 text-primary border-primary/30', icon: CheckCircle, label: 'Approved' },
  rejected: { color: 'bg-destructive/10 text-destructive border-destructive/30', icon: XCircle, label: 'Rejected' },
  paid: { color: 'bg-success/10 text-success border-success/30', icon: CreditCard, label: 'Paid' },
  cancelled: { color: 'bg-muted text-muted-foreground border-border', icon: XCircle, label: 'Cancelled' },
};

const CATEGORY_LABELS: Record<string, string> = {
  office_supplies: 'Office Supplies',
  equipment: 'Equipment',
  marketing: 'Marketing',
  logistics: 'Logistics',
  maintenance: 'Maintenance',
  subscription: 'Subscriptions',
  utility: 'Utilities',
  general: 'General',
};

export default function AdminRequisitions() {
  const { user, loading: authLoading } = useAuth();
  const { loading: permLoading } = useAdminPermissions();
  const { effectiveEnvironment } = useEnvironmentConfig();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [requisitions, setRequisitions] = useState<MyRequisition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate('/admin/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) fetchMyRequisitions();

    const channel = supabase
      .channel('my-requisitions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_requisitions' }, () => {
        fetchMyRequisitions();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, effectiveEnvironment]);

  const fetchMyRequisitions = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('expense_requisitions')
      .select('*')
      .eq('requested_by', user.id)
      .eq('environment', effectiveEnvironment)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching requisitions:', error);
    } else {
      setRequisitions((data as MyRequisition[]) || []);
    }
    setLoading(false);
  };

  if (authLoading || permLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">My Requisitions</h1>
            <p className="text-muted-foreground">Submit and track your expense requests</p>
          </div>
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Requisition
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Submit Requisition</DialogTitle>
              </DialogHeader>
              <ExpenseRequisitionForm
                onSuccess={() => {
                  setFormOpen(false);
                  toast({ title: 'Requisition submitted!', description: 'Your request has been sent for approval.' });
                  fetchMyRequisitions();
                }}
                onCancel={() => setFormOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* My Requisitions List */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : requisitions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-2">No requisitions yet</p>
              <p className="text-sm text-muted-foreground">Click "New Requisition" to submit your first request.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {requisitions.map(req => {
              const statusCfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
              const StatusIcon = statusCfg.icon;
              return (
                <Card key={req.id}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-foreground">{req.title}</h3>
                          <Badge variant="outline" className={statusCfg.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {statusCfg.label}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {CATEGORY_LABELS[req.category] || req.category}
                          </Badge>
                        </div>
                        {req.description && (
                          <p className="text-sm text-muted-foreground mb-2">{req.description}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Submitted: {format(new Date(req.created_at), 'MMM d, yyyy h:mm a')}</span>
                          {req.bank_name && <span>Bank: {req.bank_name}</span>}
                          {req.account_name && <span>Acct: {req.account_name}</span>}
                        </div>

                        {/* Status-specific details */}
                        {req.status === 'approved' && req.approved_by_name && (
                          <p className="text-xs text-primary mt-2">
                            ✓ Approved by {req.approved_by_name} on {format(new Date(req.approved_at!), 'MMM d, yyyy')}
                          </p>
                        )}
                        {req.status === 'rejected' && (
                          <div className="mt-2">
                            {req.approved_by_name && (
                              <p className="text-xs text-muted-foreground">
                                Rejected by {req.approved_by_name} on {format(new Date(req.approved_at!), 'MMM d, yyyy')}
                              </p>
                            )}
                            {req.rejection_reason && (
                              <p className="text-xs text-destructive">Reason: {req.rejection_reason}</p>
                            )}
                          </div>
                        )}
                        {req.status === 'paid' && (
                          <p className="text-xs text-success mt-2">
                            ✓ {req.payment_method === 'paystack' ? 'Paid via Paystack' : 'Paid manually'}{' '}
                            {req.paid_at && `on ${format(new Date(req.paid_at), 'MMM d, yyyy')}`}
                            {req.payment_note && ` — ${req.payment_note}`}
                          </p>
                        )}
                      </div>

                      <p className="text-lg font-bold text-foreground flex-shrink-0">
                        ₦{req.amount.toLocaleString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </AdminLayout>
  );
}
