import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

interface DispatchOffer {
  id: string;
  dispatch_request_id: string;
  rider_user_id: string;
  rider_profile_id: string;
  distance_km: number;
  delivery_fee: number;
  rider_share: number;
  priority_tier: string;
  vendor_name: string | null;
  vendor_address: string | null;
  customer_address: string | null;
  estimated_pickup_minutes: number | null;
  estimated_delivery_minutes: number | null;
  status: string;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  // Hybrid payout breakdown fields
  platform_fee: number | null;
  distance_bonus: number | null;
  time_surge_bonus: number | null;
  weather_surge_bonus: number | null;
  total_surge_bonus: number | null;
  subsidy_amount: number | null;
  weather_condition: string | null;
  time_period: string | null;
}

export function useDispatchOffers() {
  const { user } = useAuth();
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);

  const fetchOffers = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('dispatch_offers')
        .select('*')
        .eq('rider_user_id', user.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data as unknown as DispatchOffer[]) || [];

      // Defence in depth: never show a rider a job for an unpaid app/web order.
      // The database and dispatch function both block it too — this stops it
      // ever appearing on screen.
      let visible = rows;
      if (rows.length > 0) {
        const { data: requests, error: requestsError } = await supabase
          .from('dispatch_requests')
          .select('id, orders(payment_status, channel)')
          .in('id', rows.map((o) => o.dispatch_request_id));

        if (requestsError) throw requestsError;
        const allowed = new Set(
          (requests || [])
            .filter((r: any) => {
              if (!r.orders) return false;
              const channel = r.orders.channel || 'online';
              return r.orders.payment_status === 'paid' || channel === 'pos' || channel === 'assisted';
            })
            .map((r: any) => r.id),
        );
        visible = rows.filter((o) => allowed.has(o.dispatch_request_id));
      }

      setOffers(visible);
    } catch (error) {
      setOffers([]);
      console.error('Error fetching dispatch offers:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const acceptOffer = useCallback(async (offerId: string) => {
    if (!user) return { success: false, error: 'Not authenticated' };

    setAccepting(offerId);
    try {
      const { data: session } = await supabase.auth.getSession();
      
      const response = await supabase.functions.invoke('accept-dispatch', {
        body: { offerId },
        headers: {
          Authorization: `Bearer ${session.session?.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

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
        // Remove this offer from the list
        setOffers(prev => prev.filter(o => o.id !== offerId));
        return { success: false, error: result.error };
      }

      toast({
        title: '✅ Delivery Accepted!',
        description: 'Head to the vendor for pickup.',
      });

      // Remove all offers (they should all be superseded now)
      setOffers([]);
      
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
  }, [user]);

  const declineOffer = useCallback(async (offerId: string, reason?: string) => {
    if (!user) return { success: false, error: 'Not authenticated' };

    setDeclining(offerId);
    try {
      const { data: session } = await supabase.auth.getSession();
      
      const response = await supabase.functions.invoke('decline-dispatch', {
        body: { offerId, reason },
        headers: {
          Authorization: `Bearer ${session.session?.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      // Remove the declined offer from the list
      setOffers(prev => prev.filter(o => o.id !== offerId));
      
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
  }, [user]);

  // Set up real-time subscription
  useEffect(() => {
    if (!user) return;

    fetchOffers();

    const channel = supabase
      .channel('rider-dispatch-offers')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dispatch_offers',
          filter: `rider_user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Dispatch offer change:', payload);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            // Realtime payloads are not payment proof. Re-run the same
            // fail-closed discovery before displaying or sounding an offer.
            void fetchOffers();
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as any).id;
            setOffers(prev => prev.filter(o => o.id !== deletedId));
          }
        }
      )
      .subscribe();

    // Poll to remove expired offers
    const expiryInterval = setInterval(() => {
      setOffers(prev => prev.filter(o => new Date(o.expires_at) > new Date()));
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(expiryInterval);
    };
  }, [user, fetchOffers]);

  return {
    offers,
    loading,
    accepting,
    declining,
    acceptOffer,
    declineOffer,
    refetch: fetchOffers,
    pendingCount: offers.length,
  };
}
