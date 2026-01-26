import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { StaffManagement } from '@/components/vendor/StaffManagement';
import { Loader2 } from 'lucide-react';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';

export default function VendorStaff() {
  const navigate = useNavigate();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [loading, setLoading] = useState(true);
  const { hasPermission, loading: permLoading } = useVendorPermissions(vendorId);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/vendor/auth');
      return;
    }

    const { data: vendor } = await supabase
      .from('vendors')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!vendor) {
      navigate('/vendor/auth');
      return;
    }

    setVendorId(vendor.id);
    setVendorName(vendor.name);
    setLoading(false);
  };

  if (loading || permLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check if user has permission to manage staff
  if (!hasPermission('manage_staff')) {
    return (
      <div className="min-h-screen bg-background flex">
        <VendorSidebar vendorName={vendorName} />
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
      <VendorSidebar vendorName={vendorName} />
      
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6">
          {vendorId && <StaffManagement vendorId={vendorId} />}
        </div>
      </main>
    </div>
  );
}
