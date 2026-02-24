import { useState, useEffect } from 'react';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { StaffManagement } from '@/components/vendor/StaffManagement';
import { ActivityLogViewer } from '@/components/shared/ActivityLogViewer';
import { Loader2 } from 'lucide-react';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


export default function VendorStaff() {
  const navigate = useNavigate();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [loading, setLoading] = useState(true);
  const { selectedOutletId, setSelectedOutletId } = usePersistedOutletId();
  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendorId);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/vendor/auth'); return; }

    // Check if owner
    const { data: vendor } = await supabase
      .from('vendors')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (vendor) {
      setVendorId(vendor.id);
      setVendorName(vendor.name);
      setLoading(false);
      return;
    }

    // Check if staff
    const { data: staffRecord } = await supabase
      .from('vendor_staff')
      .select('vendor_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffRecord) {
      const { data: staffVendor } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('id', staffRecord.vendor_id)
        .single();
      if (staffVendor) {
        setVendorId(staffVendor.id);
        setVendorName(staffVendor.name);
        setLoading(false);
        return;
      }
    }

    navigate('/vendor/auth');
  };

  if (loading || permLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasPermission('manage_staff')) {
    return (
      <div className="min-h-screen bg-background flex">
        <VendorSidebar vendorName={vendorName} permissions={permissions} onOutletChange={setSelectedOutletId} />
        <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 flex items-center justify-center min-h-screen">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
              <p className="text-muted-foreground">You don't have permission to manage staff.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <VendorSidebar vendorName={vendorName} permissions={permissions} onOutletChange={setSelectedOutletId} />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6">
          <Tabs defaultValue="staff">
            <TabsList>
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
            </TabsList>
            <TabsContent value="staff" className="mt-4">
              {vendorId && <StaffManagement vendorId={vendorId} selectedOutletId={selectedOutletId} />}
            </TabsContent>
            <TabsContent value="activity" className="mt-4">
              {vendorId && <ActivityLogViewer entityType="vendor" entityId={vendorId} />}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
