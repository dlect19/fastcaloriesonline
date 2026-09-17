import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import type { RiderOffer } from '@/lib/riderOffers';
import {
  bindRiderOfferStore,
  clearOffersLocally,
  fetchRiderOffers,
  getRiderOfferState,
  removeOfferLocally,
  subscribeRiderOffers,
  type RiderOfferState,
} from '@/hooks/riderOfferStore';

export type DispatchOffer = RiderOffer;

/**
 * Single source of truth for rider delivery requests.
 *
 * Discovery goes through the secure server function get_my_rider_offers(),
 * which derives the rider from the session, applies the paid-only and every
 * other eligibility gate server-side, and returns its own clock. The client
 * never reads dispatch_requests/orders directly (those stay private) and never
 * trusts a realtime payload as proof — realtime only triggers a refetch.
 */
export function useDispatchOffers() {
  const { user } = useAuth();
  const [state, setState] = useState<RiderOfferState>(getRiderOfferState);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeRiderOffers(setState);
    bindRiderOfferStore(user?.id ?? null);
    setState(getRiderOfferState());
    return unsubscribe;
  }, [user?.id]);

  const refetch = useCallback(() => fetchRiderOffers(), []);

  const acceptOffer = useCallback(
    async (offerId: string) => {
      if (!user) return { success: false, error: 'Not authenticated' };
      if (accepting) return { success: false, error: 'Already accepting a delivery' };

      setAccepting(offerId);
      try {
        const { data: session } = await supabase.auth.getSession();

        const response = await supabase.functions.invoke('accept-dispatch', {
          body: { offerId },
          headers: { Authorization: `Bearer ${session.session?.access_token}` },
        });

        if (response.error) throw new Error(response.error.message);

        const result = response.data;

        if (!result.success) {
          if (result.alreadyTaken) {
            toast({
              title: 'Order Already Taken',
              description: 'Another rider accepted this delivery first.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Cannot Accept',
              description: result.error || 'Failed to accept delivery',
              variant: 'destructive',
            });
          }
          removeOfferLocally(offerId);
          void fetchRiderOffers();
          return { success: false, error: result.error };
        }

        toast({
          title: '✅ Delivery Accepted!',
          description: 'Head to the vendor for pickup.',
        });

        clearOffersLocally();
        void fetchRiderOffers();

        return { success: true, orderId: result.orderId };
      } catch (error: any) {
        console.error('Error accepting offer:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to accept delivery',
          variant: 'destructive',
        });
        return { success: false, error: error.message };
      } finally {
        setAccepting(null);
      }
    },
    [user, accepting],
  );

  const declineOffer = useCallback(
    async (offerId: string, reason?: string) => {
      if (!user) return { success: false, error: 'Not authenticated' };

      setDeclining(offerId);
      try {
        const { data: session } = await supabase.auth.getSession();

        const response = await supabase.functions.invoke('decline-dispatch', {
          body: { offerId, reason },
          headers: { Authorization: `Bearer ${session.session?.access_token}` },
        });

        if (response.error) throw new Error(response.error.message);

        removeOfferLocally(offerId);
        void fetchRiderOffers();

        return { success: true };
      } catch (error: any) {
        console.error('Error declining offer:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to decline delivery',
          variant: 'destructive',
        });
        return { success: false, error: error.message };
      } finally {
        setDeclining(null);
      }
    },
    [user],
  );

  return {
    offers: state.offers,
    loading: state.loading,
    accepting,
    declining,
    acceptOffer,
    declineOffer,
    refetch,
    pendingCount: state.offers.length,
    /** false only when the lookup failed — distinguishes error from empty. */
    ok: state.ok,
    error: state.errorMessage,
    reason: state.reason,
    excluded: state.excluded,
    serverTime: state.serverTime,
    activeOrderCount: state.activeOrderCount,
    maxConcurrentOrders: state.maxConcurrentOrders,
  };
}
