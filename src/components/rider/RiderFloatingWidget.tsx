import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapOptionsMenu } from '@/components/shared/MapOptionsMenu';
import { Package, X, Maximize2, Truck, MapPin, ShieldCheck, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { playGlobalNotificationSound, isAudioUnlocked } from '@/lib/globalAudio';

// Generate a random 6-digit confirmation code
const generateConfirmationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

interface RiderFloatingWidgetProps {
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
}

export function RiderFloatingWidget({ isOnline, onToggleOnline }: RiderFloatingWidgetProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [dispatchOfferCount, setDispatchOfferCount] = useState(0);

  useEffect(() => {
    fetchActiveOrders();
    fetchDispatchOffers();
    
    const channel = supabase
      .channel('floating-widget-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchActiveOrders()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_offers' },
        (payload) => {
          fetchDispatchOffers();
          // Play sound when a new dispatch offer arrives
          if (payload.eventType === 'INSERT') {
            playGlobalNotificationSound();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchActiveOrders = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orders } = await supabase
      .from('orders')
      .select('*, vendors(name, address, latitude, longitude)')
      .eq('rider_id', user.id)
      .not('status', 'in', '("delivered","cancelled")')
      .order('created_at', { ascending: false });

    setActiveOrderCount(orders?.length || 0);
    setActiveOrder(orders?.[0] || null);
  };

  const fetchDispatchOffers = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: offers } = await supabase
      .from('dispatch_offers')
      .select('id')
      .eq('rider_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());

    setDispatchOfferCount(offers?.length || 0);
  };


  const updateOrderStatus = async (newStatus: string) => {
    if (!activeOrder) return;
    
    // Redirect to orders page for delivery verification
    if (newStatus === 'delivered') {
      navigate('/rider/orders');
      toast({
        title: 'Verify delivery on Orders page',
        description: 'Please enter the customer\'s confirmation code to complete delivery.',
      });
      return;
    }
    
    const updateData: any = { status: newStatus };
    
    // Generate confirmation code when rider picks up the order
    if (newStatus === 'picked_up') {
      updateData.confirmation_code = generateConfirmationCode();
    }

    await supabase.from('orders').update(updateData).eq('id', activeOrder.id);
    toast({ 
      title: newStatus === 'picked_up' 
        ? '📦 Order picked up! Code sent to customer.' 
        : 'Status updated' 
    });
    fetchActiveOrders();
  };

  const getNextStatus = (currentStatus: string) => {
    const flow: Record<string, string> = {
      ready_for_pickup: 'picked_up',
      picked_up: 'on_the_way',
      on_the_way: 'delivered',
    };
    return flow[currentStatus];
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      ready_for_pickup: 'Ready for Pickup',
      picked_up: 'Picked Up',
      on_the_way: 'On the Way',
      delivered: 'Delivered',
    };
    return labels[status] || status;
  };

  if (!expanded) {
    // Minimized FAB
    return (
      <div className="fixed bottom-28 right-4 z-[60] flex items-center gap-2">
        {/* Notification bell with dispatch offer count */}
        {dispatchOfferCount > 0 && (
          <button
            onClick={() => navigate('/rider/available')}
            className="relative flex items-center justify-center w-12 h-12 rounded-full shadow-lg bg-destructive text-destructive-foreground animate-pulse"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
              {dispatchOfferCount}
            </span>
          </button>
        )}
        <button
          onClick={() => setExpanded(true)}
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all",
            isOnline 
              ? "bg-primary text-primary-foreground" 
              : "bg-muted text-muted-foreground"
          )}
        >
          <div className={cn(
            "w-2 h-2 rounded-full",
            isOnline ? "bg-calorie-low animate-pulse" : "bg-muted-foreground"
          )} />
          <Truck className="w-5 h-5" />
          {activeOrderCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeOrderCount}
            </Badge>
          )}
        </button>
      </div>
    );
  }

  // Expanded widget
  return (
    <Card className="fixed bottom-28 right-4 left-4 md:left-auto md:w-80 z-[60] shadow-xl border-2">
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Truck className="w-4 h-4" />
          Rider Mode
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/rider/orders')}>
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Online Toggle */}
        <div className="flex items-center justify-between p-2 bg-muted rounded-lg">
          <span className="text-sm font-medium">
            {isOnline ? '🟢 Online' : '⚫ Offline'}
          </span>
          <Switch checked={isOnline} onCheckedChange={onToggleOnline} />
        </div>

        {/* Active Order */}
        {activeOrder ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                #{activeOrder.order_number}
              </span>
              <Badge variant="secondary" className="text-xs">
                {getStatusLabel(activeOrder.status)}
              </Badge>
            </div>
            
            <p className="text-sm font-medium truncate">
              {activeOrder.vendors?.name}
            </p>
            
            <div className="flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{activeOrder.delivery_address_text}</span>
            </div>

            <div className="flex gap-2">
              {/* Pickup navigation - vendor location */}
              {['assigned', 'searching_for_rider', 'confirmed', 'preparing', 'ready_for_pickup'].includes(activeOrder.status) ? (
                <MapOptionsMenu 
                  address={activeOrder.vendors?.address || activeOrder.vendors?.name || ''} 
                  latitude={activeOrder.vendors?.latitude}
                  longitude={activeOrder.vendors?.longitude}
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-8"
                  label="Pickup"
                />
              ) : (
                <MapOptionsMenu 
                  address={activeOrder.delivery_address_text || ''} 
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-8"
                  label="Deliver"
                />
              )}
              {getNextStatus(activeOrder.status) && (
                <Button 
                  size="sm" 
                  className="flex-1 text-xs h-8"
                  onClick={() => updateOrderStatus(getNextStatus(activeOrder.status))}
                >
                  {getNextStatus(activeOrder.status) === 'delivered' ? (
                    <>
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Verify
                    </>
                  ) : 'Next'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-3">
            <Package className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">No active orders</p>
          </div>
        )}

        {activeOrderCount > 1 && (
          <p className="text-xs text-center text-muted-foreground">
            +{activeOrderCount - 1} more order{activeOrderCount > 2 ? 's' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
