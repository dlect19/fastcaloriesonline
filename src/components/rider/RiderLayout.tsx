import { ReactNode, useEffect, useCallback, useState, useRef } from 'react';
import { RiderSidebar } from './RiderSidebar';
import { RiderBottomNav } from './RiderBottomNav';
import { RiderMobileHeader } from './RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useRiderNativeService } from '@/hooks/useRiderNativeService';
import { useRiderLocation } from '@/hooks/useRiderLocation';
import { useEnsureLocationPermissions } from '@/hooks/useEnsureLocationPermissions';
import { useDispatchOffers } from '@/hooks/useDispatchOffers';


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
  const notifiedOfferIdsRef = useRef<Set<string>>(new Set());
  const { offers } = useDispatchOffers();
  const { ensureLocationPermissions, stopLocationService } = useEnsureLocationPermissions();

  // Fetch rider user id on mount for auto location tracking
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setRiderId(user.id);
    });
  }, []);

  // Auto-track rider GPS location and update DB every 30s when online
  useRiderLocation({ riderId: riderId || undefined, enabled: isOnline && !!riderId });

  // Gate the "go online" action behind the Prominent Disclosure + permission flow.
  const handleToggleOnline = useCallback(
    async (next: boolean) => {
      if (next) {
        const ok = await ensureLocationPermissions();
        if (!ok) return; // stay offline if location was denied
        onToggleOnline(true);
      } else {
        await stopLocationService();
        onToggleOnline(false);
      }
    },
    [ensureLocationPermissions, stopLocationService, onToggleOnline],
  );

  const handleToggleOffline = useCallback(() => {
    handleToggleOnline(false);
  }, [handleToggleOnline]);


  // Native Capacitor integration - foreground service & notification actions
  const { showOfferNotification } = useRiderNativeService({
    isOnline,
    onToggleOffline: handleToggleOffline,
  });

  // Notification eligibility comes from the same secure lookup the requests
  // page and badges use — a realtime row is never treated as proof.
  useEffect(() => {
    setPendingOfferCount(isOnline ? offers.length : 0);
  }, [offers.length, isOnline]);

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

  // Native heads-up notification, once per verified offer (no duplicates).
  useEffect(() => {
    if (!isOnline) return;
    for (const offer of offers) {
      if (notifiedOfferIdsRef.current.has(offer.id)) continue;
      notifiedOfferIdsRef.current.add(offer.id);
      showOfferNotification({
        id: offer.id,
        vendor_name: offer.vendor_name,
        rider_share: offer.rider_share || 0,
        distance_km: offer.distance_km || 0,
        delivery_fee: offer.delivery_fee || 0,
      });
    }
    const live = new Set(offers.map((o) => o.id));
    for (const id of Array.from(notifiedOfferIdsRef.current)) {
      if (!live.has(id)) notifiedOfferIdsRef.current.delete(id);
    }
  }, [offers, isOnline, showOfferNotification]);

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <RiderMobileHeader isOnline={isOnline} onToggleOnline={handleToggleOnline} />
        <main className="flex-1 p-4 pb-36">
          {children}
        </main>
        <RiderBottomNav isOnline={isOnline} onToggleOnline={handleToggleOnline} canViewEarnings={canViewEarnings} />
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <RiderSidebar isOnline={isOnline} onToggleOnline={handleToggleOnline} canViewEarnings={canViewEarnings} />
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
