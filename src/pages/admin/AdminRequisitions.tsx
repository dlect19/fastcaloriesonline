import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ExpenseRequisitionForm } from '@/components/admin/expenses/ExpenseRequisitionForm';
import { useToast } from '@/hooks/use-toast';

export default function AdminRequisitions() {
  const { user, loading: authLoading } = useAuth();
  const { loading: permLoading } = useAdminPermissions();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) navigate('/admin/auth');
  }, [user, authLoading, navigate]);

  if (authLoading || permLoading) {
    return (
      <div className="flex min-h-screen">
        <AdminSidebar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Submit Requisition</h1>
          <p className="text-muted-foreground">Request funds for company expenses</p>
        </div>

        <div className="max-w-lg">
          <ExpenseRequisitionForm
            onSuccess={() => {
              toast({ title: 'Requisition submitted!', description: 'Your request has been sent for approval.' });
            }}
            onCancel={() => navigate('/admin/dashboard')}
          />
        </div>
      </main>
    </div>
  );
}
