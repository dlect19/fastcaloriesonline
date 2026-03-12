import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useRiderLocationSubscription } from '@/hooks/useRiderLocation';
import { calculateDistance, formatDistance, calculateETA, formatETA } from '@/lib/location';
import { MapPin, Bike, Clock, Package, CheckCircle2, Navigation } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

interface DeliveryTrackingProps {
  orderId: string;
  customerLat?: number | null;
  customerLon?: number | null;
}

type Order = Tables<'orders'>;

const statusSteps = [
  { status: 'pending', label: 'Order Placed', icon: Package },
  { status: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { status: 'preparing', label: 'Preparing', icon: Package },
  { status: 'ready_for_pickup', label: 'Ready', icon: Package },
  { status: 'picked_up', label: 'Picked Up', icon: Bike },
  { status: 'on_the_way', label: 'On the Way', icon: Navigation },
  { status: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

export function DeliveryTracking({ orderId, customerLat, customerLon }: DeliveryTrackingProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [riderProfileId, setRiderProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const riderLocation = useRiderLocationSubscription(riderProfileId);

  useEffect(() => {
    fetchOrder();
    subscribeToOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (error) throw error;
      setOrder(data);

      // If order has a rider, get their profile ID
      if (data?.rider_id) {
        const { data: riderProfile } = await supabase
          .from('rider_profiles')
          .select('id')
          .eq('user_id', data.rider_id)
          .single();

        if (riderProfile) {
          setRiderProfileId(riderProfile.id);
        }
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToOrder = () => {
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const newOrder = payload.new as Order;
          setOrder(newOrder);

          // Update rider profile ID if rider assigned
          if (newOrder.rider_id && !riderProfileId) {
            supabase
              .from('rider_profiles')
              .select('id')
              .eq('user_id', newOrder.rider_id)
              .single()
              .then(({ data }) => {
                if (data) setRiderProfileId(data.id);
              });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex justify-center">
            <div className="animate-pulse space-y-4 w-full">
              <div className="h-4 bg-secondary rounded w-3/4 mx-auto"></div>
              <div className="h-2 bg-secondary rounded w-full"></div>
              <div className="h-4 bg-secondary rounded w-1/2 mx-auto"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!order) {
    return null;
  }

  const currentStatusIndex = statusSteps.findIndex(s => s.status === order.status);
  const progress = ((currentStatusIndex + 1) / statusSteps.length) * 100;

  // Calculate rider distance
  let riderDistanceKm: number | null = null;

  if (
    riderLocation.latitude &&
    riderLocation.longitude &&
    customerLat &&
    customerLon &&
    ['picked_up', 'on_the_way'].includes(order.status)
  ) {
    riderDistanceKm = calculateDistance(
      riderLocation.latitude,
      riderLocation.longitude,
      customerLat,
      customerLon
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Navigation className="w-5 h-5 text-primary" />
          Delivery Tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Order Status</span>
            <Badge variant={order.status === 'delivered' ? 'default' : 'secondary'}>
              {statusSteps[currentStatusIndex]?.label || order.status}
            </Badge>
          </div>
          <Progress value={progress} className="h-2" />
          
          {/* Status Steps */}
          <div className="flex justify-between mt-3">
            {statusSteps.slice(0, 5).map((step, index) => {
              const isCompleted = index <= currentStatusIndex;
              const isCurrent = index === currentStatusIndex;
              const StepIcon = step.icon;
              
              return (
                <div key={step.status} className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isCompleted
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground'
                    } ${isCurrent ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                  >
                    <StepIcon className="w-4 h-4" />
                  </div>
                  <span className={`text-xs mt-1 ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {step.label.split(' ')[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rider Info (when assigned and in transit) */}
        {order.rider_id && ['picked_up', 'on_the_way'].includes(order.status) && (
          <>
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bike className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Rider En Route</p>
                    <p className="text-sm text-muted-foreground">Your order is on its way!</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Distance & ETA */}
            {riderDistanceKm !== null && etaMinutes !== null && (
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-secondary rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <MapPin className="w-4 h-4" />
                    <span className="text-lg font-bold">{formatDistance(riderDistanceKm)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Distance</p>
                </div>
                <div className="p-3 bg-secondary rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <Clock className="w-4 h-4" />
                    <span className="text-lg font-bold">{formatETA(etaMinutes)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">ETA</p>
                </div>
              </div>
            )}

            {/* Last updated */}
            {riderLocation.updatedAt && (
              <p className="text-xs text-center text-muted-foreground">
                Location updated: {new Date(riderLocation.updatedAt).toLocaleTimeString()}
              </p>
            )}
          </>
        )}

        {/* Waiting for rider */}
        {!order.rider_id && order.status === 'ready_for_pickup' && (
          <div className="p-4 bg-secondary rounded-lg text-center">
            <Bike className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Finding a rider for your order...</p>
          </div>
        )}

        {/* Delivered */}
        {order.status === 'delivered' && (
          <div className="p-4 bg-calorie-low/10 rounded-lg text-center">
            <CheckCircle2 className="w-10 h-10 text-calorie-low mx-auto mb-2" />
            <p className="font-medium text-calorie-low">Order Delivered!</p>
            <p className="text-sm text-muted-foreground mt-1">Thank you for your order</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
