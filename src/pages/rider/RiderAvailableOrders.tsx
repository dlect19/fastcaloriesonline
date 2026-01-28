import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { Package, MapPin, Loader2, Navigation, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { format } from 'date-fns';

// Haversine formula for distance calculation
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export default function RiderAvailableOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);

  // Notification sound hook
  const { 
    playOnce, 
    startRepeating, 
    stopRepeating, 
    soundEnabled, 
    isBlocked, 
    setSoundEnabled, 
    unlock 
  } = useRepeatingNotificationSound({ 
    intervalMs: 10000, 
    storageKey: 'rider-available-orders-sound' 
  });

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!riderProfile) return;
    
    // Subscribe to real-time updates for available orders
    const channel = supabase
      .channel('available-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const newOrder = payload.new as any;
          const oldOrder = payload.old as any;
          
          // Check if this is a new ready_for_pickup order without a rider
          if (payload.eventType === 'UPDATE' && 
              newOrder.status === 'ready_for_pickup' && 
              !newOrder.rider_id &&
              oldOrder.status !== 'ready_for_pickup') {
            // Play notification sound for new available order
            startRepeating();
          }
          
          fetchAvailableOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderProfile]);

  // Start notification sound when there are available orders
  useEffect(() => {
    if (availableOrders.length > 0 && isOnline && !loading) {
      startRepeating();
    } else {
      stopRepeating();
    }
  }, [availableOrders.length, isOnline, loading]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile) {
      navigate('/rider/auth');
      return;
    }

    setRiderProfile(profile);
    setIsOnline(profile.is_online || false);
    await fetchAvailableOrders(profile);
  };

  const fetchAvailableOrders = async (profile = riderProfile) => {
    if (!profile) return;
    
    try {
      // Get orders that are ready for pickup and have no rider assigned
      const { data: orders, error } = await supabase
        .from('orders')
        .select('*, vendors(name, address, latitude, longitude)')
        .eq('status', 'ready_for_pickup')
        .is('rider_id', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter orders within rider's work radius
      const riderLat = profile.preferred_latitude || profile.current_latitude;
      const riderLng = profile.preferred_longitude || profile.current_longitude;
      const workRadius = profile.work_radius_km || 10;

      if (!riderLat || !riderLng) {
        setAvailableOrders([]);
        setLoading(false);
        return;
      }

      const filteredOrders = (orders || [])
        .map(order => {
          const vendorLat = order.vendors?.latitude;
          const vendorLng = order.vendors?.longitude;
          
          if (!vendorLat || !vendorLng) return null;
          
          const distance = calculateDistance(riderLat, riderLng, vendorLat, vendorLng);
          
          if (distance <= workRadius) {
            return { ...order, distance };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => (a?.distance || 0) - (b?.distance || 0));

      setAvailableOrders(filteredOrders);
    } catch (error) {
      console.error('Error fetching available orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAvailableOrders();
  };

  const claimOrder = async (orderId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setClaiming(orderId);
    
    try {
      // First check if order is still available
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('rider_id, status')
        .eq('id', orderId)
        .single();

      if (currentOrder?.rider_id) {
        toast({
          title: 'Order already claimed',
          description: 'Another rider has already claimed this order.',
          variant: 'destructive'
        });
        fetchAvailableOrders();
        return;
      }

      if (currentOrder?.status !== 'ready_for_pickup') {
        toast({
          title: 'Order unavailable',
          description: 'This order is no longer available for pickup.',
          variant: 'destructive'
        });
        fetchAvailableOrders();
        return;
      }

      // Claim the order
      const { error } = await supabase
        .from('orders')
        .update({ rider_id: user.id })
        .eq('id', orderId)
        .is('rider_id', null); // Extra safety check

      if (error) throw error;

      // Stop notification sound when order is claimed
      stopRepeating();

      toast({
        title: '🎉 Order claimed!',
        description: 'Head to the vendor to pick up the order.',
      });

      // Navigate to orders page
      navigate('/rider/orders');
    } catch (error) {
      console.error('Error claiming order:', error);
      toast({
        title: 'Failed to claim order',
        variant: 'destructive'
      });
    } finally {
      setClaiming(null);
    }
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
    
    // Stop notification sound when going offline
    if (!online) {
      stopRepeating();
    }
    
    toast({
      title: online ? 'You are now online' : 'You are now offline',
    });
  };

  const handleTestSound = () => {
    playOnce();
    toast({ title: '🔔 Sound test', description: 'Did you hear it?' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasLocation = riderProfile?.preferred_latitude || riderProfile?.current_latitude;

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Available Orders</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Orders within {riderProfile?.work_radius_km || 10}km of your location
          </p>
        </div>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Sound Enable Banner */}
      {isOnline && hasLocation && (
        <SoundEnableBanner
          soundEnabled={soundEnabled}
          isBlocked={isBlocked}
          onToggleSound={setSoundEnabled}
          onUnlock={unlock}
          onTestSound={handleTestSound}
          className="mb-4"
        />
      )}

      {!hasLocation ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Navigation className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">Location not set</p>
            <p className="text-muted-foreground text-sm mb-4">
              Please set your work location in settings to see available orders.
            </p>
            <Button onClick={() => navigate('/rider/settings')}>
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      ) : !isOnline ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">You're offline</p>
            <p className="text-muted-foreground text-sm mb-4">
              Go online to see and accept available orders.
            </p>
            <Button onClick={() => toggleOnline(true)}>
              Go Online
            </Button>
          </CardContent>
        </Card>
      ) : availableOrders.length === 0 ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No available orders nearby</p>
            <p className="text-xs text-muted-foreground mt-2">
              Pull down or tap refresh to check for new orders
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {availableOrders.map((order) => (
            <Card key={order.id}>
              <CardHeader className="flex flex-row items-center justify-between p-4 md:p-6 pb-2">
                <div>
                  <CardTitle className="text-base md:text-lg">
                    Order #{order.order_number}
                  </CardTitle>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    {format(new Date(order.created_at), 'PPp')}
                  </p>
                </div>
                <Badge variant="secondary" className="bg-calorie-medium text-white">
                  Ready for Pickup
                </Badge>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-2 space-y-4">
                {/* Vendor Info */}
                <div className="space-y-2">
                  <p className="font-medium">{order.vendors?.name}</p>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{order.vendors?.address}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Navigation className="w-4 h-4 text-primary" />
                    <span className="text-primary font-medium">
                      {order.distance?.toFixed(1)}km away
                    </span>
                  </div>
                </div>

                {/* Delivery Location */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-1">Deliver to:</p>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">{order.delivery_address_text}</span>
                  </div>
                </div>

                {/* Earnings & Actions */}
                <div className="flex items-center justify-between pt-3 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">You'll earn</p>
                    <p className="font-bold text-lg text-calorie-low">
                      ₦{(Number(order.delivery_fee || 0) * 0.8).toLocaleString()}
                    </p>
                  </div>
                  <Button 
                    onClick={() => claimOrder(order.id)}
                    disabled={claiming === order.id}
                  >
                    {claiming === order.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    Accept Order
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </RiderLayout>
  );
}
