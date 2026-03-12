import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminStaffManagement } from '@/components/admin/AdminStaffManagement';
import { ActivityLogViewer } from '@/components/shared/ActivityLogViewer';
import { Loader2 } from 'lucide-react';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AdminStaff() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading: permLoading, hasPermission } = useAdminPermissions();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
    }
  };

  if (permLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasPermission('manage_admin_staff')) {
    return (
      <AdminLayout>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
              <p className="text-muted-foreground">Only Super Admins can manage admin staff.</p>
            </div>
          </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
          <TabsList>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>
          <TabsContent value="staff" className="mt-4">
            <AdminStaffManagement />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ActivityLogViewer entityType="admin" />
          </TabsContent>
        </Tabs>
    </AdminLayout>
  );
}
