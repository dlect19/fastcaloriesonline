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
      
      // Type assertion since we know the structure matches
      setOffers((data as unknown as DispatchOffer[]) || []);
    } catch (error) {
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
          
          if (payload.eventType === 'INSERT') {
            const newOffer = payload.new as unknown as DispatchOffer;
            if (newOffer.status === 'pending' && new Date(newOffer.expires_at) > new Date()) {
              setOffers(prev => [newOffer, ...prev.filter(o => o.id !== newOffer.id)]);
              
              // Play notification sound for new offer
              try {
                const audio = new Audio('/sounds/new-order.mp3');
                audio.volume = 0.5;
                audio.play().catch(() => {});
              } catch (e) {
                console.log('Could not play notification sound');
              }

              toast({
                title: '🚗 New Delivery Request!',
                description: `${newOffer.vendor_name} - ₦${newOffer.rider_share?.toLocaleString()} delivery fee`,
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedOffer = payload.new as unknown as DispatchOffer;
            if (updatedOffer.status !== 'pending') {
              // Remove non-pending offers
              setOffers(prev => prev.filter(o => o.id !== updatedOffer.id));
            } else {
              // Update the offer in place
              setOffers(prev => prev.map(o => o.id === updatedOffer.id ? updatedOffer : o));
            }
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
