import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PayrollEmployeeList } from '@/components/admin/payroll/PayrollEmployeeList';
import { PayrollRunDialog } from '@/components/admin/payroll/PayrollRunDialog';
import { PayrollHistory } from '@/components/admin/payroll/PayrollHistory';
import { PayrollProfitOverview } from '@/components/admin/payroll/PayrollProfitOverview';
import { PayrollResetDialog } from '@/components/admin/payroll/PayrollResetDialog';
import { PaystackBalanceCard } from '@/components/admin/PaystackBalanceCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Users, Play, History } from 'lucide-react';

export default function AdminPayroll() {
  const { user, loading: authLoading } = useAuth();
  const { isSuperAdmin, loading: permLoading } = useAdminPermissions();
  const navigate = useNavigate();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) navigate('/admin/auth');
  }, [user, authLoading, navigate]);

  if (authLoading || permLoading) {
    return (
      <AdminLayout>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </AdminLayout>
    );
  }

  if (!isSuperAdmin) {
    return (
      <AdminLayout>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Access denied. Super admin only.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Payroll</h1>
            <p className="text-muted-foreground">Manage staff salaries and payments</p>
          </div>
          <div className="flex gap-3">
            <PayrollResetDialog onResetComplete={() => setRefreshKey(k => k + 1)} />
            <Button onClick={() => setRunDialogOpen(true)} className="gap-2">
              <Play className="w-4 h-4" />
              Run Payroll
            </Button>
          </div>
        </div>

        {/* Profit & Payroll Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <PayrollProfitOverview key={`profit-${refreshKey}`} />
          </div>
          <PaystackBalanceCard />
        </div>

        <Tabs defaultValue="employees" className="space-y-6">
          <TabsList>
            <TabsTrigger value="employees" className="gap-2">
              <Users className="w-4 h-4" />
              Employees
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Payroll History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employees">
            <PayrollEmployeeList key={`emp-${refreshKey}`} />
          </TabsContent>

          <TabsContent value="history">
            <PayrollHistory key={`hist-${refreshKey}`} />
          </TabsContent>
        </Tabs>

        <PayrollRunDialog
          open={runDialogOpen}
          onOpenChange={setRunDialogOpen}
          onSuccess={() => setRefreshKey(k => k + 1)}
        />
      </main>
    </div>
  );
}