import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { CompanyProfitCard } from '@/components/admin/CompanyProfitCard';
import { PaystackBalanceCard } from '@/components/admin/PaystackBalanceCard';
import { NinBvnBalanceCard } from '@/components/admin/NinBvnBalanceCard';
import { ExpenseRequisitionList } from '@/components/admin/expenses/ExpenseRequisitionList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { FileText, ClipboardList } from 'lucide-react';

export default function AdminExpenses() {
  const { user, loading: authLoading } = useAuth();
  const { isSuperAdmin, hasPermission, loading: permLoading } = useAdminPermissions();
  const { effectiveEnvironment } = useEnvironmentConfig();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Expenses</h1>
            <p className="text-muted-foreground">Manage company expenses and requisitions</p>
          </div>
        </div>

        {/* Financial Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <CompanyProfitCard environment={effectiveEnvironment} />
          </div>
          <div className="space-y-6">
            <PaystackBalanceCard />
            <NinBvnBalanceCard />
          </div>
        </div>

        {/* Requisitions */}
        <Tabs defaultValue="pending" className="space-y-6">
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <ClipboardList className="w-4 h-4" />
              Pending Approval
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              <FileText className="w-4 h-4" />
              All Requisitions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <ExpenseRequisitionList
              key={`pending-${refreshKey}`}
              filter="pending"
              onUpdate={() => setRefreshKey(k => k + 1)}
            />
          </TabsContent>

          <TabsContent value="all">
            <ExpenseRequisitionList
              key={`all-${refreshKey}`}
              filter="all"
              onUpdate={() => setRefreshKey(k => k + 1)}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
