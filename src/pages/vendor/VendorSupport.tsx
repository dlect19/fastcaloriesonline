import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { SupportPage } from '@/components/support/SupportPage';
import { Leaf } from 'lucide-react';

export default function VendorSupport() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/vendor/auth');
        return;
      }
      setUserId(user.id);

      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('user_id', user.id)
        .maybeSingle();

      if (vendor) {
        setVendorName(vendor.name);
        setVendorId(vendor.id);
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
      <VendorSidebar vendorName={vendorName} />
      <main className="flex-1 lg:ml-64 p-6 pt-20 lg:pt-6">
        <SupportPage userId={userId} userType="vendor" />
      </main>
    </div>
  );
}
