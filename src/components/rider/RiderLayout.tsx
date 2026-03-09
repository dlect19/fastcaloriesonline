import { ReactNode, useEffect, useCallback, useState, useRef } from 'react';
import { RiderSidebar } from './RiderSidebar';
import { RiderBottomNav } from './RiderBottomNav';
import { RiderMobileHeader } from './RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useRiderNativeService } from '@/hooks/useRiderNativeService';
import { useRiderLocation } from '@/hooks/useRiderLocation';

interface RiderLayoutProps {
  children: ReactNode;
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderLayout({ children, isOnline, onToggleOnline, canViewEarnings = true }: RiderLayoutProps) {
  const isMobile = useIsMobile();
  const [riderId, setRiderId] = useState<string | null>(null);
  const [pendingOfferCount, setPendingOfferCount] = useState(0);
  const repeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch rider user id on mount for auto location tracking
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setRiderId(user.id);
    });
  }, []);

  // Auto-track rider GPS location and update DB every 30s when online
  useRiderLocation({ riderId: riderId || undefined, enabled: isOnline && !!riderId });

  const handleToggleOffline = useCallback(() => {
    onToggleOnline(false);
  }, [onToggleOnline]);

  // Native Capacitor integration - foreground service & notification actions
  const { showOfferNotification } = useRiderNativeService({
    isOnline,
    onToggleOffline: handleToggleOffline,
  });

  // Fetch pending dispatch offers count for the current rider
  const fetchPendingOffers = useCallback(async () => {
    if (!riderId || !isOnline) {
      setPendingOfferCount(0);
      return;
    }
    const { count } = await supabase
      .from('dispatch_offers')
      .select('id', { count: 'exact', head: true })
      .eq('rider_user_id', riderId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    setPendingOfferCount(count || 0);
  }, [riderId, isOnline]);

  // Check pending offers on mount and when online status changes
  useEffect(() => {
    fetchPendingOffers();
  }, [fetchPendingOffers]);

  // Repeating notification sound when there are pending offers (works on ALL rider pages)
  useEffect(() => {
    if (pendingOfferCount > 0 && isOnline) {
      // Play immediately
      playGlobalNotificationSound();
      // Then repeat every 10 seconds
      if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = setInterval(() => {
        playGlobalNotificationSound();
      }, 10000);
    } else {
      if (repeatIntervalRef.current) {
        clearInterval(repeatIntervalRef.current);
        repeatIntervalRef.current = null;
      }
    }
    return () => {
      if (repeatIntervalRef.current) {
        clearInterval(repeatIntervalRef.current);
        repeatIntervalRef.current = null;
      }
    };
  }, [pendingOfferCount, isOnline]);

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
            // Refresh pending count so repeating sound kicks in
            fetchPendingOffers();
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dispatch_offers' },
        async (payload) => {
          // When offers are accepted/declined/expired, refresh count to stop sound
          const { data: { user } } = await supabase.auth.getUser();
          if (user && payload.new && (payload.new as any).rider_user_id === user.id) {
            fetchPendingOffers();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showOfferNotification, fetchPendingOffers]);

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
    <div className="h-screen bg-background flex overflow-hidden">
      <RiderSidebar isOnline={isOnline} onToggleOnline={onToggleOnline} canViewEarnings={canViewEarnings} />
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
