import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { ConfirmationCodeDialog } from '@/components/rider/ConfirmationCodeDialog';
import { ControlledDeliveryOtpDialog, type ControlledItem } from '@/components/rider/ControlledDeliveryOtpDialog';

import { ReassignOrderDialog } from '@/components/rider/ReassignOrderDialog';
import { RiderOrderChat } from '@/components/rider/RiderOrderChat';
import { MapOptionsMenu } from '@/components/shared/MapOptionsMenu';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, MapPin, Phone, Clock, Loader2, ShieldCheck, RefreshCw, Lock, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';
import { format } from 'date-fns';

// Generate a random 6-digit confirmation code
const generateConfirmationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export default function RiderOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { playOnce, startRepeating, stopRepeating, soundEnabled, isBlocked, setSoundEnabled, unlock } = useRepeatingNotificationSound({ 
    intervalMs: 10000, 
    storageKey: 'rider-notification-sound' 
  });
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [floatModeEnabled, setFloatModeEnabled] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingDeliveryOrder, setPendingDeliveryOrder] = useState<any>(null);
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [orderToReassign, setOrderToReassign] = useState<any>(null);
  const [controlledDialogOpen, setControlledDialogOpen] = useState(false);
  const [controlledItems, setControlledItems] = useState<ControlledItem[]>([]);

  

  // Use rider restrictions hook
  const { isAffiliated, canViewEarnings } = useRiderRestrictions(riderProfile);

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
              playOnce();
              toast({
                title: '🚚 New Delivery!',
                description: `Order #${payload.new.order_number} has been assigned to you.`,
              });
            }
            
            // If any status changed, stop sound — effect will restart if needed
            if (payload.new.status !== payload.old.status) {
              stopRepeating();
            }
          }
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, playOnce, stopRepeating, toast]);

  // Re-evaluate sound whenever active orders change
  useEffect(() => {
    if (loading) return;
    const hasUnactioned = activeOrders.some(o => 
      ['assigned', 'searching_for_rider', 'ready_for_pickup', 'confirmed'].includes(o.status)
    );
    if (hasUnactioned) {
      startRepeating();
    } else {
      stopRepeating();
    }
  }, [activeOrders, loading]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }
    setUserId(user.id);

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    setRiderProfile(profile);
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
        .select('*, vendors(name, address, phone, latitude, longitude), vendor_outlets(outlet_name, outlet_surname, address, city, state, latitude, longitude), addresses!delivery_address_id(latitude, longitude)')
        .eq('rider_id', user.id)
        .not('status', 'in', '("delivered","cancelled")')
        .order('created_at', { ascending: false });

      // Completed orders
      const { data: completed } = await supabase
        .from('orders')
        .select('*, vendors(name, address, phone), vendor_outlets(outlet_name, outlet_surname, address, city, state, latitude, longitude), addresses!delivery_address_id(latitude, longitude)')
        .eq('rider_id', user.id)
        .in('status', ['delivered', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(20);

      // Fetch order items for active orders so rider can verify packing
      const activeOrderIds = (active || []).map(o => o.id);
      let orderItemsMap: Record<string, any[]> = {};
      if (activeOrderIds.length > 0) {
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('id, order_id, product_name, quantity, special_instructions, package_id')
          .in('order_id', activeOrderIds);
        
        if (orderItems) {
          orderItems.forEach(item => {
            if (!orderItemsMap[item.order_id]) orderItemsMap[item.order_id] = [];
            orderItemsMap[item.order_id].push(item);
          });
        }
      }

      // Fetch customer profiles for all orders
      const allOrders = [...(active || []), ...(completed || [])];
      const customerIds = [...new Set(allOrders.map(o => o.user_id).filter(Boolean))];
      
      let profilesMap: Record<string, { full_name: string | null; phone: string | null }> = {};
      if (customerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', customerIds);
        
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map(p => [p.user_id, { full_name: p.full_name, phone: p.phone }]));
        }
      }

      // Attach customer profiles and order items to orders
      const attachExtras = (orders: any[], withItems: boolean) => orders.map(o => ({
        ...o,
        customer_profile: o.user_id ? profilesMap[o.user_id] || { full_name: o.receiver_name, phone: o.receiver_phone } : { full_name: o.receiver_name, phone: o.receiver_phone },
        ...(withItems ? { order_items: orderItemsMap[o.id] || [] } : {}),
      }));

      setActiveOrders(attachExtras(active || [], true));
      setCompletedOrders(attachExtras(completed || [], false));
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string, order?: any) => {
    // Stop notification sound when rider takes action — effect will restart if needed
    stopRepeating();

    // If trying to deliver, check controlled items first, then open confirmation dialog
    if (newStatus === 'delivered') {
      const targetOrder = order || activeOrders.find(o => o.id === orderId);
      setPendingDeliveryOrder(targetOrder);

      // Fetch any controlled items still needing OTP verification
      const { data: items } = await supabase
        .from('order_items')
        .select('id, product_name, quantity, delivery_otp, delivery_otp_verified_at, products(medicine_classification)')
        .eq('order_id', orderId);
      const pending = (items || []).filter((it: any) =>
        it.products?.medicine_classification === 'controlled' &&
        it.delivery_otp &&
        !it.delivery_otp_verified_at
      );

      if (pending.length > 0) {
        setControlledItems(pending.map((it: any) => ({
          id: it.id,
          product_name: it.product_name,
          quantity: it.quantity,
        })));
        setControlledDialogOpen(true);
      } else {
        setConfirmDialogOpen(true);
      }
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
      await fetchOrders();
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
      const { data: deliveredOrder, error: deliverError } = await supabase
        .from('orders')
        .update({ 
          status: 'delivered', 
          delivered_at: new Date().toISOString() 
        })
        .eq('id', pendingDeliveryOrder.id)
        .select('id, status, delivered_at')
        .maybeSingle();

      if (deliverError) throw deliverError;
      if (!deliveredOrder || deliveredOrder.status !== 'delivered') {
        throw new Error('Delivery could not be completed. Please refresh and try again.');
      }

      // Log calories for the customer on delivery
      try {
        await supabase.functions.invoke('log-order-calories', {
          body: { orderId: pendingDeliveryOrder.id }
        });
      } catch (calorieError) {
        console.error('Failed to log calories:', calorieError);
      }

      // Log delivery distance via edge function (server-side to bypass RLS)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        supabase.functions.invoke('log-delivery-distance', {
          body: { orderId: pendingDeliveryOrder.id, riderId: user.id }
        }).catch(err => console.error('Failed to log distance:', err));
      }

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
      // Vendor-affiliated riders may see these statuses
      confirmed: 'preparing',
      preparing: 'ready_for_pickup',
      assigned: 'picked_up', // Direct assignment status
      searching_for_rider: 'picked_up', // Dispatch system status
      ready_for_pickup: 'picked_up',
      picked_up: 'on_the_way',
      on_the_way: 'delivered',
    };
    return flow[currentStatus];
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      confirmed: 'bg-calorie-medium text-white',
      preparing: 'bg-yellow-500 text-white',
      assigned: 'bg-primary text-white',
      searching_for_rider: 'bg-primary text-white',
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

    // Stop repeating sound when going offline
    if (!online) {
      stopRepeating();
    }

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
    toast({
      title: online ? 'You are now online' : 'You are now offline',
    });
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

      {/* Sound notification controls */}
      <SoundEnableBanner
        soundEnabled={soundEnabled}
        isBlocked={isBlocked}
        onToggleSound={setSoundEnabled}
        onUnlock={unlock}
        onTestSound={playOnce}
        className="mb-4"
      />

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
                    {(order as any).package_count > 1 && (
                      <Badge variant="secondary" className="mt-1 text-xs gap-1">
                        <Package className="w-3 h-3" />
                        {(order as any).package_count} packages
                      </Badge>
                    )}
                  </div>
                  {getStatusBadge(order.status)}
                </CardHeader>
                <CardContent className="space-y-4 p-4 md:p-6 pt-0">
                  {/* Order Items - for packing verification */}
                  {order.order_items && order.order_items.length > 0 && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🧾 Order Items — Verify before pickup</p>
                      {order.order_items.map((item: any) => (
                        <div key={item.id} className="flex items-start justify-between text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{item.quantity}× {item.product_name}</span>
                            {item.special_instructions && (
                              <p className="text-xs text-muted-foreground italic">Note: {item.special_instructions}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pickup Location */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Pickup From</p>
                        <MapOptionsMenu 
                          address={(order.vendor_outlets?.address || order.vendors?.address) || ''} 
                          latitude={order.vendor_outlets?.latitude || order.vendors?.latitude}
                          longitude={order.vendor_outlets?.longitude || order.vendors?.longitude}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {order.vendor_outlets?.outlet_surname 
                              ? `${order.vendors?.name} – ${order.vendor_outlets.outlet_surname}`
                              : order.vendors?.name}
                          </p>
                          <p className="break-words">{order.vendor_outlets?.address || order.vendors?.address}</p>
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
                        <MapOptionsMenu 
                          address={order.delivery_address_text || ''} 
                          latitude={order.addresses?.latitude}
                          longitude={order.addresses?.longitude}
                          className="h-7 text-xs"
                        />
                      </div>
                      {order.customer_profile?.full_name && (
                        <p className="text-sm font-medium text-foreground">{order.customer_profile.full_name}</p>
                      )}
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <p className="break-words">{order.delivery_address_text}</p>
                      </div>
                      {order.customer_profile?.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4" />
                          <a href={`tel:${order.customer_profile.phone}`} className="text-primary">
                            {order.customer_profile.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {order.delivery_instructions && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary flex items-start gap-2 whitespace-pre-wrap">
                      <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{order.delivery_instructions}</span>
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t">
                    {/* Only show earnings for platform riders (not affiliated) */}
                    {canViewEarnings && !isAffiliated ? (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Delivery Fee: ₦{(Number(order.delivery_fee) || 0).toLocaleString()}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Lock className="w-4 h-4" />
                        {isAffiliated ? 'Managed by your vendor' : 'Vendor delivery'}
                      </div>
                    )}

                    {getNextStatus(order.status) && (
                      <div className="flex gap-2 flex-wrap">
                        {/* Reassign Button - only for active deliveries */}
                        {['picked_up', 'on_the_way'].includes(order.status) && (
                          <Button 
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setOrderToReassign(order);
                              setReassignDialogOpen(true);
                            }}
                            className="text-warning border-warning/50 hover:bg-warning/10"
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Reassign
                          </Button>
                        )}
                        
                        <Button 
                          onClick={() => updateOrderStatus(order.id, getNextStatus(order.status), order)}
                          className="flex-1 md:flex-none"
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
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <RiderOrderChat orderId={order.id} orderNumber={order.order_number} />
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
                    {canViewEarnings && !isAffiliated ? (
                      <p className="font-medium">₦{(Number(order.delivery_fee) || 0).toLocaleString()}</p>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <Lock className="w-3 h-3 mr-1" />
                        {isAffiliated ? 'Managed by vendor' : 'Completed'}
                      </Badge>
                    )}
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

      {/* Controlled-drug OTP verification (runs before final confirmation) */}
      <ControlledDeliveryOtpDialog
        open={controlledDialogOpen}
        onOpenChange={setControlledDialogOpen}
        items={controlledItems}
        verify={async (codes) => {
          // Verify each item's delivery_otp; if all match, stamp verified_at
          const ids = Object.keys(codes);
          const { data: rows, error } = await supabase
            .from('order_items')
            .select('id, delivery_otp')
            .in('id', ids);
          if (error || !rows) return false;
          const allMatch = rows.every((r: any) => codes[r.id] && r.delivery_otp === codes[r.id]);
          if (!allMatch) return false;
          await supabase
            .from('order_items')
            .update({ delivery_otp_verified_at: new Date().toISOString() })
            .in('id', ids);
          return true;
        }}
        onVerified={() => {
          setControlledDialogOpen(false);
          setConfirmDialogOpen(true);
        }}
      />

      {/* Confirmation Code Dialog */}
      <ConfirmationCodeDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handleConfirmDelivery}
        isLoading={confirmingDelivery}
        orderNumber={pendingDeliveryOrder?.order_number}
      />


      {/* Reassign Order Dialog */}
      <ReassignOrderDialog
        open={reassignDialogOpen}
        onOpenChange={setReassignDialogOpen}
        order={orderToReassign}
        onReassigned={fetchOrders}
      />
    </RiderLayout>
  );
}
