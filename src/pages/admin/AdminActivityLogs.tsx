import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ActivityLogViewer } from '@/components/shared/ActivityLogViewer';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AdminActivityLogs() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/admin/auth'); return; }
      const { data: roles } = await supabase
        .from('user_roles').select('role').eq('user_id', user.id);
      if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Staff Activity Logs</h1>
          <p className="text-sm text-muted-foreground">
            Every action performed by admin staff — approvals, edits, order attendance, settings changes and more.
          </p>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="admin">Admin</TabsTrigger>
            <TabsTrigger value="vendor">Vendors</TabsTrigger>
            <TabsTrigger value="rider">Riders</TabsTrigger>
            <TabsTrigger value="delivery_company">Delivery Co.</TabsTrigger>
            <TabsTrigger value="promo_code">Promos</TabsTrigger>
            <TabsTrigger value="order">Orders</TabsTrigger>
            <TabsTrigger value="setting">Settings</TabsTrigger>
            <TabsTrigger value="presence">Presence</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            <ActivityLogViewer limit={200} />
          </TabsContent>
          {['admin','vendor','rider','delivery_company','promo_code','order','setting','presence'].map(t => (
            <TabsContent key={t} value={t} className="mt-4">
              <ActivityLogViewer entityType={t} limit={200} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
