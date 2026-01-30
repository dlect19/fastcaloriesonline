import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BottomNav } from '@/components/home/BottomNav';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RiderReviewForm } from '@/components/order/RiderReviewForm';
import { RiderInfoCard } from '@/components/order/RiderInfoCard';
import { ArrowLeft, Package, Check, Truck, MapPin, Phone, Loader2, Store, Clock, Bike, ShieldCheck, Star } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const DELIVERY_ORDER_STATUSES = [
  { key: 'pending', label: 'Order Placed', icon: Package },
  { key: 'confirmed', label: 'Confirmed', icon: Check },
  { key: 'preparing', label: 'Preparing', icon: Store },
  { key: 'ready_for_pickup', label: 'Ready for Rider', icon: Clock },
  { key: 'picked_up', label: 'Picked Up', icon: Bike },
  { key: 'on_the_way', label: 'On the Way', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: MapPin },
];

const SELF_PICKUP_ORDER_STATUSES = [
  { key: 'pending', label: 'Order Placed', icon: Package },
  { key: 'confirmed', label: 'Confirmed', icon: Check },
  { key: 'preparing', label: 'Preparing', icon: Store },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: Clock },
  { key: 'delivered', label: 'Picked Up', icon: MapPin },
];

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasReviewed, setHasReviewed] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (id) {
      fetchOrder();
      subscribeToOrder();
    }
  }, [id, user, authLoading]);

  const fetchOrder = async () => {
    try {
      const { data: orderData } = await supabase
        .from('orders')
        .select('*, vendors(name, phone, address)')
        .eq('id', id)
        .single();

      setOrder(orderData);

      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      setOrderItems(items || []);

      // Check if user has already reviewed this order
      if (orderData?.status === 'delivered') {
        const { data: review } = await supabase
          .from('reviews')
          .select('id')
          .eq('order_id', id)
          .maybeSingle();
        
        setHasReviewed(!!review);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToOrder = () => {
    const channel = supabase
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          setOrder((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const getOrderStatuses = () => {
    return order?.delivery_type === 'self_pickup' ? SELF_PICKUP_ORDER_STATUSES : DELIVERY_ORDER_STATUSES;
  };

  const getCurrentStepIndex = () => {
    if (!order) return 0;
    if (order.status === 'cancelled') return -1;
    const statuses = getOrderStatuses();
    const index = statuses.findIndex(s => s.key === order.status);
    return index >= 0 ? index : 0;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Order not found</p>
      </div>
    );
  }

  const currentStep = getCurrentStepIndex();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/orders')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Order #{order.order_number}</h1>
            <p className="text-sm text-muted-foreground">
              {format(new Date(order.created_at), 'PPp')}
            </p>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Status Tracker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Order Status</CardTitle>
          </CardHeader>
          <CardContent>
            {order.status === 'cancelled' ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Package className="w-8 h-8 text-destructive" />
                </div>
                <p className="font-medium text-destructive">Order Cancelled</p>
                {order.cancellation_reason && (
                  <p className="text-sm text-muted-foreground mt-2">{order.cancellation_reason}</p>
                )}
              </div>
            ) : (
              <div className="relative">
                {getOrderStatuses().map((status, index) => {
                  const isCompleted = index <= currentStep;
                  const isCurrent = index === currentStep;
                  const Icon = status.icon;

                  return (
                    <div key={status.key} className="flex items-start gap-4 mb-6 last:mb-0">
                      <div className="relative">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                            isCompleted ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                            isCurrent && "ring-4 ring-primary/20"
                          )}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        {index < getOrderStatuses().length - 1 && (
                          <div
                            className={cn(
                              "absolute left-1/2 top-10 -translate-x-1/2 w-0.5 h-6",
                              index < currentStep ? "bg-primary" : "bg-border"
                            )}
                          />
                        )}
                      </div>
                      <div className="flex-1 pt-2">
                        <p className={cn(
                          "font-medium",
                          isCompleted ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {status.label}
                        </p>
                        {isCurrent && order.estimated_delivery_at && order.delivery_type !== 'self_pickup' && (
                          <p className="text-sm text-primary">
                            Est. arrival: {format(new Date(order.estimated_delivery_at), 'p')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vendor Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Restaurant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Store className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium">{order.vendors?.name}</span>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <span className="text-muted-foreground">{order.vendors?.address}</span>
            </div>
            {order.vendors?.phone && (
              <a href={`tel:${order.vendors.phone}`} className="flex items-center gap-3 text-primary">
                <Phone className="w-5 h-5" />
                <span>{order.vendors.phone}</span>
              </a>
            )}
          </CardContent>
        </Card>

        {/* Delivery Address or Pickup Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {order.delivery_type === 'self_pickup' ? 'Pickup Location' : 'Delivery Address'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <span>
                {order.delivery_type === 'self_pickup' 
                  ? order.vendors?.address 
                  : order.delivery_address_text}
              </span>
            </div>
            {order.delivery_type === 'self_pickup' && (
              <p className="text-xs text-primary mt-2 flex items-center gap-1">
                <Store className="w-3 h-3" /> Self-Pickup Order
              </p>
            )}
          </CardContent>
        </Card>

        {/* Rider Info - Only for delivery orders when picked up or on the way */}
        {order.delivery_type !== 'self_pickup' && order.rider_id && ['picked_up', 'on_the_way'].includes(order.status) && (
          <RiderInfoCard riderId={order.rider_id} />
        )}

        {/* Confirmation Code - Show for self-pickup when ready, or delivery when picked up/on the way */}
        {order.confirmation_code && (
          (order.delivery_type === 'self_pickup' && order.status === 'ready_for_pickup') ||
          (order.delivery_type !== 'self_pickup' && ['picked_up', 'on_the_way'].includes(order.status))
        ) && (
          <Alert className="border-primary bg-primary/5">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <AlertTitle className="text-primary">
              {order.delivery_type === 'self_pickup' ? 'Pickup Verification Code' : 'Delivery Confirmation Code'}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-muted-foreground">
                {order.delivery_type === 'self_pickup' 
                  ? 'Show this code to the vendor when you pick up your order:'
                  : 'Give this code to the rider when they arrive to confirm delivery:'}
              </p>
              <div className="flex items-center justify-center gap-2 py-3">
                <span className="text-3xl font-bold tracking-[0.5em] text-foreground">
                  {order.confirmation_code}
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {order.delivery_type === 'self_pickup'
                  ? 'This code verifies that you are the order owner'
                  : 'Do not share this code until you receive your order'}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Review Form - Show after delivery */}
        {order.status === 'delivered' && !hasReviewed && (
          <RiderReviewForm
            orderId={order.id}
            riderId={order.rider_id}
            vendorId={order.vendor_id}
            onReviewSubmitted={() => setHasReviewed(true)}
          />
        )}

        {/* Already reviewed message */}
        {order.status === 'delivered' && hasReviewed && (
          <Card className="border-calorie-low/30 bg-calorie-low/5">
            <CardContent className="py-4 flex items-center gap-3">
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              <span className="text-muted-foreground">You've reviewed this order</span>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Order Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {orderItems.map((item) => (
              <div key={item.id} className="flex justify-between">
                <div>
                  <p className="font-medium">{item.quantity}x {item.product_name}</p>
                  {item.calories > 0 && (
                    <p className="text-sm text-muted-foreground">{item.calories} kcal</p>
                  )}
                </div>
                <p className="font-medium">₦{Number(item.total_price).toLocaleString()}</p>
              </div>
            ))}

            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>₦{Number(order.subtotal).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery Fee</span>
                <span>₦{Number(order.delivery_fee || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Service Fee</span>
                <span>₦{Number(order.service_fee || 0).toLocaleString()}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-calorie-low">
                  <span>Discount</span>
                  <span>-₦{Number(order.discount).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total</span>
                <span className="text-primary">₦{Number(order.total).toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <BottomNav />
    </div>
  );
}
