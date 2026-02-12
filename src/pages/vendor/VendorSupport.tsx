import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { SupportPage } from '@/components/support/SupportPage';
import { Leaf } from 'lucide-react';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';

export default function VendorSupport() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [loading, setLoading] = useState(true);
  const { permissions } = useVendorPermissions(vendorId);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/vendor/auth');
        return;
      }
      setUserId(user.id);

      // Check if owner
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('user_id', user.id)
        .maybeSingle();

      if (vendor) {
        setVendorName(vendor.name);
        setVendorId(vendor.id);
      } else {
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
            setVendorName(staffVendor.name);
            setVendorId(staffVendor.id);
          }
        }
      }
      setLoading(false);
    };
    init();
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <Leaf className="w-9 h-9 text-primary-foreground" />
        </div>
      </div>
    );
  }

  if (!userId) return null;

  return (
    <div className="min-h-screen bg-background flex">
      <VendorSidebar vendorName={vendorName} permissions={permissions} />
      <main className="flex-1 lg:ml-64 p-6 pt-20 lg:pt-6">
        <SupportPage userId={userId} userType="vendor" />
      </main>
    </div>
  );
}
