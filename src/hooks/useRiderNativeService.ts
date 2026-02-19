/**
 * Hook: useRiderNativeService
 * 
 * Integrates the Capacitor RiderServicePlugin with the rider's
 * online/offline state and dispatch offer system.
 * 
 * - Starts/stops foreground service on online toggle
 * - Shows heads-up notifications for new dispatch offers
 * - Handles accept/reject actions from native notification buttons
 */

import { useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import RiderServicePlugin from '@/plugins/RiderServicePlugin';

interface UseRiderNativeServiceOptions {
  isOnline: boolean;
  onAcceptOffer?: (offerId: string) => Promise<any>;
  onDeclineOffer?: (offerId: string) => Promise<any>;
  onToggleOffline?: () => void;
}

export function useRiderNativeService({
  isOnline,
  onAcceptOffer,
  onDeclineOffer,
  onToggleOffline,
}: UseRiderNativeServiceOptions) {
  const isNative = Capacitor.isNativePlatform();
  const listenersRef = useRef<Array<{ remove: () => void }>>([]);

  // Start/stop foreground service based on online status
  useEffect(() => {
    if (!isNative) return;

    if (isOnline) {
      RiderServicePlugin.startForegroundService({
        title: 'FastCalories Rider',
        body: 'You are online and receiving delivery requests',
        channelId: 'rider_foreground',
      }).catch(console.error);
    } else {
      RiderServicePlugin.stopForegroundService().catch(console.error);
    }

    return () => {
      if (!isOnline) return;
      RiderServicePlugin.stopForegroundService().catch(console.error);
    };
  }, [isOnline, isNative]);

  // Set up native action listeners
  useEffect(() => {
    if (!isNative) return;

    const setupListeners = async () => {
      // Listen for accept/reject from native notification buttons
      const dispatchListener = await RiderServicePlugin.addListener(
        'dispatchAction',
        async (data) => {
          if (data.action === 'accept' && onAcceptOffer) {
            await onAcceptOffer(data.offerId);
          } else if (data.action === 'reject' && onDeclineOffer) {
            await onDeclineOffer(data.offerId);
          }
        },
      );

      // Listen for toggle-offline from foreground notification
      const offlineListener = await RiderServicePlugin.addListener(
        'toggleOffline',
        () => {
          onToggleOffline?.();
        },
      );

      listenersRef.current = [dispatchListener, offlineListener];
    };

    setupListeners();

    return () => {
      listenersRef.current.forEach(l => l.remove());
      listenersRef.current = [];
    };
  }, [isNative, onAcceptOffer, onDeclineOffer, onToggleOffline]);

  /**
   * Show a native heads-up notification for a new dispatch offer.
   * Call this when a new offer arrives via Realtime subscription.
   */
  const showOfferNotification = useCallback(
    async (offer: {
      id: string;
      vendor_name: string | null;
      rider_share: number;
      distance_km: number;
      delivery_fee: number;
    }) => {
      if (!isNative) return;

      await RiderServicePlugin.showHeadsUpNotification({
        title: '🚗 New Delivery Request!',
        body: `${offer.vendor_name || 'Restaurant'} • ₦${offer.rider_share.toLocaleString()}`,
        deliveryFee: offer.delivery_fee,
        distanceKm: offer.distance_km,
        vendorName: offer.vendor_name || 'Restaurant',
        offerId: offer.id,
        riderShare: offer.rider_share,
        timeoutSeconds: 90,
      });
    },
    [isNative],
  );

  /**
   * Dismiss a native notification when offer expires or is handled.
   */
  const dismissOfferNotification = useCallback(
    async (offerId: string) => {
      if (!isNative) return;
      await RiderServicePlugin.dismissHeadsUpNotification({ offerId });
    },
    [isNative],
  );

  return {
    isNative,
    showOfferNotification,
    dismissOfferNotification,
  };
}
