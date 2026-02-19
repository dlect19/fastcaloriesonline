import { ReactNode, useEffect, useCallback } from 'react';
import { RiderSidebar } from './RiderSidebar';
import { RiderBottomNav } from './RiderBottomNav';
import { RiderMobileHeader } from './RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useRiderNativeService } from '@/hooks/useRiderNativeService';

interface RiderLayoutProps {
  children: ReactNode;
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderLayout({ children, isOnline, onToggleOnline, canViewEarnings = true }: RiderLayoutProps) {
  const isMobile = useIsMobile();

  const handleToggleOffline = useCallback(() => {
    onToggleOnline(false);
  }, [onToggleOnline]);

  // Native Capacitor integration - foreground service & notification actions
  const { showOfferNotification } = useRiderNativeService({
    isOnline,
    onToggleOffline: handleToggleOffline,
  });

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
            // Also trigger native heads-up notification on Android
            const offer = payload.new as any;
            showOfferNotification({
              id: offer.id,
              vendor_name: offer.vendor_name,
              rider_share: offer.rider_share || 0,
              distance_km: offer.distance_km || 0,
              delivery_fee: offer.delivery_fee || 0,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showOfferNotification]);

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
