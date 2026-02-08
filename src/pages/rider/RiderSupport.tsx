import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SupportPage } from '@/components/support/SupportPage';
import { RiderSidebar } from '@/components/rider/RiderSidebar';
import { RiderBottomNav } from '@/components/rider/RiderBottomNav';
import { RiderMobileHeader } from '@/components/rider/RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { Leaf } from 'lucide-react';

export default function RiderSupport() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/rider/auth');
        return;
      }
      setUserId(user.id);
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

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <RiderMobileHeader isOnline={false} onToggleOnline={() => {}} />
        <main className="flex-1 p-4 pb-36">
          <SupportPage userId={userId} userType="rider" />
        </main>
        <RiderBottomNav isOnline={false} onToggleOnline={() => {}} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <RiderSidebar isOnline={false} onToggleOnline={() => {}} />
      <main className="flex-1 p-8">
        <SupportPage userId={userId} userType="rider" />
      </main>
    </div>
  );
}
