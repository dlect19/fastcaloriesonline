import { ReactNode, useEffect, useRef } from 'react';
import { RiderSidebar } from './RiderSidebar';
import { RiderBottomNav } from './RiderBottomNav';
import { RiderMobileHeader } from './RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { playGlobalNotificationSound } from '@/lib/globalAudio';

interface RiderLayoutProps {
  children: ReactNode;
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderLayout({ children, isOnline, onToggleOnline, canViewEarnings = true }: RiderLayoutProps) {
  const isMobile = useIsMobile();

  // Global dispatch offer sound listener - active on ALL rider pages
  useEffect(() => {
    const channel = supabase
      .channel('rider-layout-dispatch-sound')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dispatch_offers' },
        async (payload) => {
          // Only play sound if this offer is for the current rider
          const { data: { user } } = await supabase.auth.getUser();
          if (user && payload.new && (payload.new as any).rider_user_id === user.id) {
            playGlobalNotificationSound();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <RiderMobileHeader isOnline={isOnline} onToggleOnline={onToggleOnline} />
        <main className="flex-1 p-4 pb-36">
          {children}
        </main>
        <RiderBottomNav isOnline={isOnline} onToggleOnline={onToggleOnline} canViewEarnings={canViewEarnings} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <RiderSidebar isOnline={isOnline} onToggleOnline={onToggleOnline} canViewEarnings={canViewEarnings} />
      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}
