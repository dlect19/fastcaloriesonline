import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { DeliveryStaffManagement } from '@/components/delivery/DeliveryStaffManagement';
import { ActivityLogViewer } from '@/components/shared/ActivityLogViewer';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function DeliveryStaff() {
  const navigate = useNavigate();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/delivery/auth'); return; }

    const { data: company } = await supabase
      .from('delivery_companies')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!company) { navigate('/delivery/auth'); return; }
    setCompanyId(company.id);
    setCompanyName(company.name);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <DeliverySidebar companyName={companyName} />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6">
          <Tabs defaultValue="staff">
            <TabsList>
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
            </TabsList>
            <TabsContent value="staff" className="mt-4">
              {companyId && <DeliveryStaffManagement companyId={companyId} />}
            </TabsContent>
            <TabsContent value="activity" className="mt-4">
              {companyId && <ActivityLogViewer entityType="delivery_company" entityId={companyId} />}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
