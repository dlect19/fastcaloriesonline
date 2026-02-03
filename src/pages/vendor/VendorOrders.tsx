import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, Package, ChevronDown, ChevronUp, ShoppingBag, Store, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { OrderRiderInfo } from '@/components/vendor/OrderRiderInfo';
import { SelfPickupVerifyDialog } from '@/components/vendor/SelfPickupVerifyDialog';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { DispatchStatus } from '@/components/vendor/DispatchStatus';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useToast } from '@/hooks/use-toast';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, Database } from '@/integrations/supabase/types';

type Order = Tables<'orders'>;
type OrderItem = Tables<'order_items'>;
type OrderStatus = Database['public']['Enums']['order_status'];
type Vendor = Tables<'vendors'>;

type OrderWithItems = Order & { items: OrderItem[] };

const statusFlow: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'searching_for_rider',
  'assigned',
  'picked_up',
  'on_the_way',
  'delivered',
];

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-warning/10 text-warning', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-info/10 text-info', icon: CheckCircle },
  preparing: { label: 'Preparing', color: 'bg-primary/10 text-primary', icon: Clock },
  ready_for_pickup: { label: 'Ready', color: 'bg-accent/10 text-accent', icon: Package },
  searching_for_rider: { label: 'Finding Rider', color: 'bg-warning/10 text-warning', icon: Search },
  assigned: { label: 'Rider Assigned', color: 'bg-info/10 text-info', icon: CheckCircle },
  picked_up: { label: 'Picked Up', color: 'bg-info/10 text-info', icon: Package },
  on_the_way: { label: 'On the Way', color: 'bg-primary/10 text-primary', icon: Package },
  delivered: { label: 'Delivered', color: 'bg-success/10 text-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive', icon: XCircle },
};

export default function VendorOrders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { playOnce, startRepeating, stopRepeating, soundEnabled, isBlocked, setSoundEnabled, unlock } = useRepeatingNotificationSound({ 
    intervalMs: 10000, 
    storageKey: 'vendor-notification-sound' 
  });
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [selfPickupDialog, setSelfPickupDialog] = useState<{ open: boolean; order: OrderWithItems | null }>({ open: false, order: null });

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  // Subscribe to real-time order updates
  useEffect(() => {
    if (!vendor) return;

    const channel = supabase
      .channel('vendor-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `vendor_id=eq.${vendor.id}`,
        },
        (payload) => {
          const newOrder = payload.new as Order;
          const oldOrder = payload.old as Partial<Order>;
          
          if (payload.eventType === 'INSERT') {
            // Start repeating notification for new orders
            startRepeating();
            toast({
              title: '🔔 New Order!',
              description: 'You have a new order to process. Accept to stop the notification.',
            });
          }
          
          // Notify when order is cancelled by customer
          if (payload.eventType === 'UPDATE' && newOrder.status === 'cancelled' && oldOrder.status !== 'cancelled') {
            stopRepeating(); // Stop any notification sound
            toast({
              title: '❌ Order Cancelled',
              description: `Order #${newOrder.order_number} has been cancelled${newOrder.cancellation_reason ? `: ${newOrder.cancellation_reason}` : ''}`,
              variant: 'destructive',
            });
          }
          
          // Notify when rider is assigned and stop notification sound
          if (payload.eventType === 'UPDATE' && newOrder.rider_id && !oldOrder.rider_id) {
            stopRepeating(); // Stop notification sound when rider accepts order
            toast({
              title: '🚴 Rider Assigned!',
              description: `A rider has been assigned to order #${newOrder.order_number}`,
            });
          }
          
          // Notify when order is picked up
          if (payload.eventType === 'UPDATE' && newOrder.status === 'picked_up' && oldOrder.status !== 'picked_up') {
            toast({
              title: '📦 Order Picked Up!',
              description: `Order #${newOrder.order_number} has been picked up by the rider`,
            });
          }
          
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendor]);

  const fetchData = async () => {
    try {
      // First check if user is a vendor owner
      let vendorData = null;
      const { data: ownedVendor } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (ownedVendor) {
        vendorData = ownedVendor;
      } else {
        // Check if user is staff of any vendor
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user?.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          const { data: staffVendor } = await supabase
            .from('vendors')
            .select('*')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      if (vendorData) {
        // Fetch orders with their items
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .order('created_at', { ascending: false });

        if (ordersData && ordersData.length > 0) {
          // Fetch all order items for these orders
          const orderIds = ordersData.map(o => o.id);
          const { data: itemsData } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds);

          // Map items to their orders
          const ordersWithItems: OrderWithItems[] = ordersData.map(order => ({
            ...order,
            items: (itemsData || []).filter(item => item.order_id === order.id)
          }));

          setOrders(ordersWithItems);
        } else {
          setOrders([]);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);

      if (error) throw error;

      // Stop notification sound when vendor confirms/updates an order
      stopRepeating();

      // Dispatch order to riders when order becomes ready for pickup
      if (newStatus === 'ready_for_pickup') {
        try {
          const { data, error: dispatchError } = await supabase.functions.invoke('dispatch-order', {
            body: { orderId }
          });
          
          if (dispatchError) {
            console.error('Error dispatching order:', dispatchError);
            toast({ 
              title: 'Dispatch started', 
              description: 'Searching for nearby riders...',
            });
          } else if (data?.success) {
            if (data.eligibleRiderCount > 0) {
              toast({ 
                title: '🔔 Dispatching to riders', 
                description: `Notifying ${data.eligibleRiderCount} nearby riders`,
              });
            } else {
              toast({ 
                title: 'Searching for riders', 
                description: 'No riders online yet. Will retry automatically.',
                variant: 'destructive',
              });
            }
          }
        } catch (dispatchErr) {
          console.error('Failed to call dispatch-order:', dispatchErr);
        }
      }

      toast({ title: `Order updated to ${statusConfig[newStatus].label}` });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error updating order',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Vendors can only update status up to ready_for_pickup
  // Riders handle picked_up, on_the_way, and delivered statuses
  const getNextStatus = (currentStatus: OrderStatus): OrderStatus | null => {
    const vendorStatusFlow: OrderStatus[] = [
      'pending', 'confirmed', 'preparing', 'ready_for_pickup'
    ];
    const currentIndex = vendorStatusFlow.indexOf(currentStatus);
    if (currentIndex === -1 || currentIndex >= vendorStatusFlow.length - 1) return null;
    return vendorStatusFlow[currentIndex + 1];
  };

  const activeOrders = orders.filter((o) =>
    ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'searching_for_rider', 'assigned'].includes(o.status)
  );
  const completedOrders = orders.filter((o) =>
    ['delivered', 'cancelled', 'picked_up', 'on_the_way'].includes(o.status)
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  if (authLoading || loading || permLoading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!hasPermission('process_orders')) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendor?.name} permissions={permissions} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <AccessDenied message="You don't have permission to manage orders." />
        </main>
      </div>
    );
  }

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const renderOrderCard = (order: OrderWithItems) => {
    const status = statusConfig[order.status] || statusConfig.pending;
    const StatusIcon = status.icon;
    const nextStatus = getNextStatus(order.status as OrderStatus);
    const isExpanded = expandedOrders.has(order.id);

    return (
      <div
        key={order.id}
        className="bg-card rounded-xl border border-border overflow-hidden"
      >
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-semibold text-foreground">{order.order_number}</p>
              <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
            </div>
            <Badge className={`${status.color} border-0`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {status.label}
            </Badge>
          </div>

          {/* Order Items Preview */}
          <Collapsible open={isExpanded} onOpenChange={() => toggleOrderExpanded(order.id)}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors mb-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">
                    {order.items.length} item{order.items.length !== 1 ? 's' : ''} in order
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="bg-muted/30 rounded-lg p-3 mb-3 space-y-2">
                {order.items.length > 0 ? (
                  order.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-start text-sm">
                      <div className="flex-1">
                        <p className="font-medium text-foreground">
                          {item.quantity}x {item.product_name}
                        </p>
                        {item.special_instructions && (
                          <p className="text-xs text-muted-foreground italic mt-0.5">
                            Note: {item.special_instructions}
                          </p>
                        )}
                        {item.calories && item.calories > 0 && (
                          <p className="text-xs text-muted-foreground">{item.calories} cal</p>
                        )}
                      </div>
                      <p className="font-medium text-foreground">
                        ₦{Number(item.total_price).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No items found
                  </p>
                )}
                
                {/* Order Summary - Vendors only see their revenue (subtotal minus discounts) */}
                <div className="border-t border-border pt-2 mt-2 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Meal Total</span>
                    <span>₦{Number(order.subtotal).toLocaleString()}</span>
                  </div>
                  {order.discount && Number(order.discount) > 0 && (
                    <div className="flex justify-between text-xs text-calorie-low">
                      <span>Discount</span>
                      <span>-₦{Number(order.discount).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold pt-1 border-t border-border">
                    <span>Your Revenue</span>
                    <span className="text-primary">₦{Number(order.subtotal - (order.discount || 0)).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Delivery fees and service charges go to riders/platform
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {order.total_calories ? `${order.total_calories} cal • ` : ''}
                ₦{Number(order.subtotal).toLocaleString()}
              </p>
              {/* Show delivery type indicator */}
              {order.delivery_type === 'self_pickup' ? (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <Store className="w-3 h-3" /> Self-Pickup
                </p>
              ) : order.delivery_address_text && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  📍 {order.delivery_address_text}
                </p>
              )}
            </div>

            {/* Self-pickup verify button when order is ready */}
            {order.delivery_type === 'self_pickup' && order.status === 'ready_for_pickup' && (
              <Button 
                size="sm" 
                className="gap-1 bg-calorie-low hover:bg-calorie-low/90"
                onClick={() => setSelfPickupDialog({ open: true, order })}
              >
                <CheckCircle className="w-4 h-4" />
                Verify & Deliver
              </Button>
            )}

            {/* Regular delivery order actions */}
            {order.delivery_type !== 'self_pickup' && order.status !== 'delivered' && order.status !== 'cancelled' && nextStatus && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="gap-1">
                    Update
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {nextStatus && (
                    <DropdownMenuItem
                      onClick={() => updateOrderStatus(order.id, nextStatus)}
                    >
                      Mark as {statusConfig[nextStatus].label}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => updateOrderStatus(order.id, 'cancelled')}
                  >
                    Cancel Order
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Self-pickup orders status update (before ready) */}
            {order.delivery_type === 'self_pickup' && order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'ready_for_pickup' && nextStatus && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="gap-1">
                    Update
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {nextStatus && (
                    <DropdownMenuItem
                      onClick={() => updateOrderStatus(order.id, nextStatus)}
                    >
                      Mark as {statusConfig[nextStatus].label}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => updateOrderStatus(order.id, 'cancelled')}
                  >
                    Cancel Order
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Dispatch Status - Show when searching for rider */}
        {order.delivery_type !== 'self_pickup' && 
         ['ready_for_pickup', 'searching_for_rider'].includes(order.status) && 
         !order.rider_id && (
          <div className="px-4 pb-4">
            <DispatchStatus 
              orderId={order.id} 
              orderNumber={order.order_number}
              onRiderAssigned={fetchData}
            />
          </div>
        )}

        {/* Rider Info - Only for delivery orders */}
        {order.delivery_type !== 'self_pickup' && order.rider_id && ['assigned', 'ready_for_pickup', 'picked_up', 'on_the_way', 'delivered'].includes(order.status) && (
          <div className="px-4 pb-4">
            <OrderRiderInfo riderId={order.rider_id} orderStatus={order.status} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} permissions={permissions} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Orders</h1>
            <p className="text-muted-foreground">
              {activeOrders.length} active • {completedOrders.length} completed
            </p>
          </div>

          {/* Sound notification controls */}
          <SoundEnableBanner
            soundEnabled={soundEnabled}
            isBlocked={isBlocked}
            onToggleSound={setSoundEnabled}
            onUnlock={unlock}
            onTestSound={playOnce}
          />

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="active" className="gap-2">
                Active
                {activeOrders.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {activeOrders.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-6">
              {activeOrders.length === 0 ? (
                <div className="text-center py-16 bg-card rounded-2xl border border-border">
                  <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No active orders</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeOrders.map(renderOrderCard)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed" className="mt-6">
              {completedOrders.length === 0 ? (
                <div className="text-center py-16 bg-card rounded-2xl border border-border">
                  <CheckCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No completed orders yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {completedOrders.map(renderOrderCard)}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Self-Pickup Verification Dialog */}
          {selfPickupDialog.order && (
            <SelfPickupVerifyDialog
              open={selfPickupDialog.open}
              onOpenChange={(open) => setSelfPickupDialog({ ...selfPickupDialog, open })}
              orderId={selfPickupDialog.order.id}
              orderNumber={selfPickupDialog.order.order_number}
              confirmationCode={selfPickupDialog.order.confirmation_code || ''}
              onVerified={() => {
                fetchData();
                setSelfPickupDialog({ open: false, order: null });
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
