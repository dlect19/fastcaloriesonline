import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { ConfirmationCodeDialog } from '@/components/rider/ConfirmationCodeDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, MapPin, Phone, Clock, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { format } from 'date-fns';

// Generate a random 6-digit confirmation code
const generateConfirmationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export default function RiderOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { playNotification } = useNotificationSound();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [floatModeEnabled, setFloatModeEnabled] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingDeliveryOrder, setPendingDeliveryOrder] = useState<any>(null);
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const previousOrderCount = useRef<number>(0);

  useEffect(() => {
    checkAuth();
    const savedFloatMode = localStorage.getItem('rider_float_mode');
    setFloatModeEnabled(savedFloatMode === 'true');
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Subscribe to real-time order updates
    const channel = supabase
      .channel('rider-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `rider_id=eq.${userId}`,
        },
        (payload) => {
          // Check if this is a new order assignment
          if (payload.eventType === 'UPDATE' && payload.new.rider_id === userId) {
            const wasJustAssigned = payload.old.rider_id !== userId;
            if (wasJustAssigned) {
              playNotification();
              toast({
                title: '🚚 New Delivery!',
                description: `Order #${payload.new.order_number} has been assigned to you.`,
              });
            }
          }
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, playNotification, toast]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }
    setUserId(user.id);

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('is_online')
      .eq('user_id', user.id)
      .maybeSingle();

    setIsOnline(profile?.is_online || false);
    await fetchOrders();
  };

  const fetchOrders = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      // Active orders (assigned to this rider, not delivered/cancelled)
      const { data: active } = await supabase
        .from('orders')
        .select('*, vendors(name, address, phone, latitude, longitude)')
        .eq('rider_id', user.id)
        .not('status', 'in', '("delivered","cancelled")')
        .order('created_at', { ascending: false });

      // Check if there are new orders
      if (active && active.length > previousOrderCount.current && previousOrderCount.current > 0) {
        playNotification();
        toast({
          title: '🚚 New Delivery!',
          description: 'You have a new order assigned.',
        });
      }
      previousOrderCount.current = active?.length || 0;

      // Completed orders
      const { data: completed } = await supabase
        .from('orders')
        .select('*, vendors(name, address, phone)')
        .eq('rider_id', user.id)
        .in('status', ['delivered', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(20);

      setActiveOrders(active || []);
      setCompletedOrders(completed || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string, order?: any) => {
    // If trying to deliver, open confirmation dialog instead
    if (newStatus === 'delivered') {
      setPendingDeliveryOrder(order || activeOrders.find(o => o.id === orderId));
      setConfirmDialogOpen(true);
      return;
    }

    try {
      const updateData: any = { status: newStatus };
      
      // Generate confirmation code when rider picks up the order
      if (newStatus === 'picked_up') {
        updateData.confirmation_code = generateConfirmationCode();
      }

      await supabase.from('orders').update(updateData).eq('id', orderId);
      toast({ 
        title: newStatus === 'picked_up' 
          ? '📦 Order picked up! Confirmation code sent to customer.' 
          : 'Status updated successfully' 
      });
      fetchOrders();
    } catch (error) {
      console.error('Error updating order:', error);
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  };

  const handleConfirmDelivery = async (enteredCode: string) => {
    if (!pendingDeliveryOrder) return;
    
    setConfirmingDelivery(true);
    
    try {
      // Verify the confirmation code
      const { data: order } = await supabase
        .from('orders')
        .select('confirmation_code')
        .eq('id', pendingDeliveryOrder.id)
        .single();

      if (!order?.confirmation_code || order.confirmation_code !== enteredCode) {
        toast({
          title: 'Invalid code',
          description: 'The confirmation code does not match. Please ask the customer for the correct code.',
          variant: 'destructive'
        });
        setConfirmingDelivery(false);
        return;
      }

      // Code is correct, mark as delivered
      await supabase
        .from('orders')
        .update({ 
          status: 'delivered', 
          delivered_at: new Date().toISOString() 
        })
        .eq('id', pendingDeliveryOrder.id);

      toast({ title: '✅ Order delivered successfully!' });
      setConfirmDialogOpen(false);
      setPendingDeliveryOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error confirming delivery:', error);
      toast({ title: 'Failed to confirm delivery', variant: 'destructive' });
    } finally {
      setConfirmingDelivery(false);
    }
  };

  const getNextStatus = (currentStatus: string) => {
    const flow: Record<string, string> = {
      ready_for_pickup: 'picked_up',
      picked_up: 'on_the_way',
      on_the_way: 'delivered',
    };
    return flow[currentStatus];
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ready_for_pickup: 'bg-calorie-medium text-white',
      picked_up: 'bg-blue-500 text-white',
      on_the_way: 'bg-purple-500 text-white',
      delivered: 'bg-calorie-low text-white',
      cancelled: 'bg-destructive text-white',
    };
    return <Badge className={colors[status] || 'bg-secondary'}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
    toast({
      title: online ? 'You are now online' : 'You are now offline',
    });
  };

  const openInMaps = (address: string, lat?: number, lng?: number) => {
    const query = lat && lng 
      ? `${lat},${lng}` 
      : encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Deliveries</h1>
        <p className="text-muted-foreground text-sm md:text-base">Manage your delivery orders</p>
      </div>

      <Tabs defaultValue="active">
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="active" className="flex-1 md:flex-none">Active ({activeOrders.length})</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1 md:flex-none">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4 mt-4">
          {activeOrders.length === 0 ? (
            <Card>
              <CardContent className="p-6 md:p-8 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No active deliveries</p>
              </CardContent>
            </Card>
          ) : (
            activeOrders.map((order) => (
              <Card key={order.id}>
                <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-2 p-4 md:p-6">
                  <div>
                    <CardTitle className="text-base md:text-lg">Order #{order.order_number}</CardTitle>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      {format(new Date(order.created_at), 'PPp')}
                    </p>
                  </div>
                  {getStatusBadge(order.status)}
                </CardHeader>
                <CardContent className="space-y-4 p-4 md:p-6 pt-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pickup Location */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Pickup From</p>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => openInMaps(
                            order.vendors?.address, 
                            order.vendors?.latitude, 
                            order.vendors?.longitude
                          )}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Map
                        </Button>
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{order.vendors?.name}</p>
                          <p className="break-words">{order.vendors?.address}</p>
                        </div>
                      </div>
                      {order.vendors?.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4" />
                          <a href={`tel:${order.vendors.phone}`} className="text-primary">
                            {order.vendors.phone}
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Delivery Location */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Deliver To</p>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => openInMaps(order.delivery_address_text)}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Map
                        </Button>
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <p className="break-words">{order.delivery_address_text}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Earning: ₦{(Number(order.total) * 0.1).toLocaleString()}
                      </span>
                    </div>

                    {getNextStatus(order.status) && (
                      <Button 
                        onClick={() => updateOrderStatus(order.id, getNextStatus(order.status), order)}
                        className="w-full md:w-auto"
                      >
                        {getNextStatus(order.status) === 'delivered' ? (
                          <>
                            <ShieldCheck className="w-4 h-4 mr-2" />
                            Verify & Deliver
                          </>
                        ) : (
                          `Mark as ${getNextStatus(order.status).replace(/_/g, ' ')}`
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4 mt-4">
          {completedOrders.length === 0 ? (
            <Card>
              <CardContent className="p-6 md:p-8 text-center">
                <p className="text-muted-foreground">No completed deliveries yet</p>
              </CardContent>
            </Card>
          ) : (
            completedOrders.map((order) => (
              <Card key={order.id}>
                <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-2 p-4 md:p-6">
                  <div>
                    <CardTitle className="text-base md:text-lg">Order #{order.order_number}</CardTitle>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      {format(new Date(order.created_at), 'PPp')}
                    </p>
                  </div>
                  {getStatusBadge(order.status)}
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground truncate">
                      {order.vendors?.name} → {order.delivery_address_text?.split(',')[0]}
                    </p>
                    <p className="font-medium">₦{(Number(order.total) * 0.1).toLocaleString()}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Floating Widget */}
      {floatModeEnabled && (
        <RiderFloatingWidget isOnline={isOnline} onToggleOnline={toggleOnline} />
      )}

      {/* Confirmation Code Dialog */}
      <ConfirmationCodeDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handleConfirmDelivery}
        isLoading={confirmingDelivery}
        orderNumber={pendingDeliveryOrder?.order_number}
      />
    </RiderLayout>
  );
}
