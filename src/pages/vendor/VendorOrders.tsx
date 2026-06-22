import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, Package, ChevronDown, ChevronUp, ShoppingBag, Store, Search, Bike, MessageSquare, RefreshCcw, Repeat } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
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
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { OrderRiderInfo } from '@/components/vendor/OrderRiderInfo';
import { SelfPickupVerifyDialog } from '@/components/vendor/SelfPickupVerifyDialog';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { DispatchStatus } from '@/components/vendor/DispatchStatus';
import { ManualRiderAssignment } from '@/components/vendor/ManualRiderAssignment';
import { RiderAssignmentDialog } from '@/components/vendor/RiderAssignmentDialog';
import { CancelOrderDialog } from '@/components/vendor/CancelOrderDialog';
import { VendorOrderChat } from '@/components/vendor/VendorOrderChat';
import { PrepTimeDialog } from '@/components/vendor/PrepTimeDialog';
import { OrderProofPhotoUpload } from '@/components/vendor/OrderProofPhotoUpload';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { useToast } from '@/hooks/use-toast';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, Database } from '@/integrations/supabase/types';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';
import { cn } from '@/lib/utils';

function PrepCountdown({ estimatedAt, prepMinutes }: { estimatedAt: string; prepMinutes?: number | null }) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const target = new Date(estimatedAt).getTime();
      const diff = target - now;
      if (diff <= 0) {
        const overMs = Math.abs(diff);
        const overMin = Math.floor(overMs / 60000);
        const overSec = Math.floor((overMs % 60000) / 1000);
        setTimeLeft(`+${overMin}:${overSec.toString().padStart(2, '0')} overdue`);
        setIsOverdue(true);
      } else {
        const min = Math.floor(diff / 60000);
        const sec = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${min}:${sec.toString().padStart(2, '0')}`);
        setIsOverdue(false);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [estimatedAt]);

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-sm font-medium ${isOverdue ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
      <Clock className="w-4 h-4" />
      <span>Prep countdown: {timeLeft}</span>
      {prepMinutes && <span className="text-xs opacity-70">({prepMinutes} min set)</span>}
    </div>
  );
}

type Order = Tables<'orders'>;
type OrderItem = Tables<'order_items'>;
type OrderStatus = Database['public']['Enums']['order_status'];
type Vendor = Tables<'vendors'>;

type OrderItemAddon = {
  id: string;
  order_item_id: string;
  addon_group_name: string;
  addon_item_name: string;
  additional_price: number;
  calories: number | null;
  image_url: string | null;
};

type OrderItemWithAddons = OrderItem & {
  addons?: OrderItemAddon[];
  package_id?: string | null;
};

type OrderPackage = {
  id: string;
  order_id: string;
  recipient_name: string;
  note: string | null;
  sort_order: number;
};

type OrderWithItems = Order & { 
  items: OrderItemWithAddons[];
  packages?: OrderPackage[];
  customer?: {
    full_name: string | null;
    phone: string | null;
  } | null;
};

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
  const [outletData, setOutletData] = useState<{ address?: string; latitude?: number; longitude?: number; outlet_surname?: string } | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [selfPickupDialog, setSelfPickupDialog] = useState<{ open: boolean; order: OrderWithItems | null }>({ open: false, order: null });
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; order: OrderWithItems | null }>({ open: false, order: null });
  const [prepTimeDialog, setPrepTimeDialog] = useState<{ open: boolean; order: OrderWithItems | null }>({ open: false, order: null });
  const [prepTimeSettings, setPrepTimeSettings] = useState<{ enabled: boolean; restaurantOptions?: number[]; otherOptions?: number[] }>({ enabled: true });
  const [showManualAssignForOrder, setShowManualAssignForOrder] = useState<string | null>(null);
  const [riderAssignDialog, setRiderAssignDialog] = useState<{ open: boolean; order: OrderWithItems | null }>({ open: false, order: null });
  const [substituteDialog, setSubstituteDialog] = useState<{
    open: boolean;
    scope: 'item' | 'addon';
    id: string;
    originalName: string;
    originalPrice: number;
    orderNumber: string;
    totalQuantity: number;
  } | null>(null);
  const [subForm, setSubForm] = useState<{ name: string; note: string; refund: string; matchedPrice: number | null; quantity: string }>({ name: '', note: '', refund: '', matchedPrice: null, quantity: '1' });
  const [subSubmitting, setSubSubmitting] = useState(false);
  const [menuOptions, setMenuOptions] = useState<{ id: string; name: string; price: number; is_available: boolean }[]>([]);
  const [completedPage, setCompletedPage] = useState(1);
  const { selectedOutletId, setSelectedOutletId, ready: outletReady } = usePersistedOutletId();
  const ITEMS_PER_PAGE = 10;

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }

    if (!user || !outletReady) return;

    if (!selectedOutletId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    fetchData();
    fetchPrepTimeSettings();
  }, [user, authLoading, navigate, selectedOutletId, outletReady]);

  const fetchPrepTimeSettings = async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['prep_time_enabled', 'prep_time_restaurant_options', 'prep_time_other_options']);
      
      if (data) {
        const map: Record<string, string> = {};
        data.forEach(d => { map[d.key] = d.value; });
        const parseOptions = (val: string | undefined, def: number[]) => {
          if (!val) return def;
          return val.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
        };
        setPrepTimeSettings({
          enabled: map['prep_time_enabled'] !== 'false',
          restaurantOptions: parseOptions(map['prep_time_restaurant_options'], [5, 10, 15, 30]),
          otherOptions: parseOptions(map['prep_time_other_options'], [10, 15, 20, 25, 30, 35, 40]),
        });
      }
    } catch (err) {
      console.error('Error fetching prep time settings:', err);
    }
  };

  // Load vendor menu (for substitute autocomplete)
  useEffect(() => {
    if (!vendor?.id) { setMenuOptions([]); return; }
    let q = supabase.from('products')
      .select('id, name, price, is_available, outlet_id')
      .eq('vendor_id', vendor.id)
      .order('name')
      .limit(500);
    if (selectedOutletId) q = q.or(`outlet_id.eq.${selectedOutletId},outlet_id.is.null`);
    q.then(({ data }) => {
      setMenuOptions((data || []).map((p: any) => ({
        id: p.id, name: p.name, price: Number(p.price), is_available: p.is_available,
      })));
    });
  }, [vendor?.id, selectedOutletId]);


  // Subscribe to real-time order updates — scoped to selected outlet
  useEffect(() => {
    if (!vendor || !selectedOutletId) return;

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

          // Only react to orders for the currently selected outlet
          const orderOutletId = (newOrder as any).outlet_id || (oldOrder as any).outlet_id;
          if (orderOutletId !== selectedOutletId) return;
          
          if (payload.eventType === 'INSERT') {
            // Play sound for each new order
            playOnce();
            // Start repeating for pending orders
            startRepeating();
            toast({
              title: '🔔 New Order!',
              description: 'You have a new order to process.',
            });
          }
          
          // When ANY order status changes, stop sound and re-evaluate after data refresh
          if (payload.eventType === 'UPDATE' && newOrder.status !== oldOrder.status) {
            stopRepeating();
            const wasReleasedFromAssistedPayment =
              (newOrder as any).channel === 'assisted' &&
              (newOrder as any).payment_status === 'paid' &&
              (oldOrder as any).payment_status !== 'paid';

            if (wasReleasedFromAssistedPayment || (newOrder.status === 'confirmed' && oldOrder.status === 'pending')) {
              playOnce();
              startRepeating();
              toast({
                title: '🔔 New Confirmed Order!',
                description: (newOrder as any).delivery_instructions || 'A paid order is ready to process.',
              });
            }
            
            // Notify when order is cancelled by customer
            if (newOrder.status === 'cancelled' && oldOrder.status !== 'cancelled') {
              toast({
                title: '❌ Order Cancelled',
                description: `Order #${newOrder.order_number} has been cancelled${newOrder.cancellation_reason ? `: ${newOrder.cancellation_reason}` : ''}`,
                variant: 'destructive',
              });
            }
            
            // Notify when rider is assigned
            if (newOrder.rider_id && !oldOrder.rider_id) {
              toast({
                title: '🚴 Rider Assigned!',
                description: `A rider has been assigned to order #${newOrder.order_number}`,
              });
            }
            
            // Notify when order is picked up
            if (newOrder.status === 'picked_up' && oldOrder.status !== 'picked_up') {
              toast({
                title: '📦 Order Picked Up!',
                description: `Order #${newOrder.order_number} has been picked up by the rider`,
              });
            }
          }
          
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendor, selectedOutletId]);

  // Re-evaluate sound whenever orders change: play only if pending orders exist
  useEffect(() => {
    if (loading) return;
    const hasPending = orders.some(o => ['pending', 'confirmed'].includes(o.status));
    if (hasPending) {
      startRepeating();
    } else {
      stopRepeating();
    }
  }, [orders, loading]);

  const fetchData = async () => {
    if (!selectedOutletId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);

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

      // Fetch outlet-specific data (address, coordinates)
      if (selectedOutletId) {
        const { data: outlet } = await supabase
          .from('vendor_outlets')
          .select('address, latitude, longitude, outlet_surname')
          .eq('id', selectedOutletId)
          .single();
        setOutletData(outlet || null);
      }

      if (vendorData) {
        // Fetch orders with their items for selected outlet only
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .eq('outlet_id', selectedOutletId)
          .order('created_at', { ascending: false });

        const visibleOrders = (ordersData || []).filter((order) => !(order.channel === 'assisted' && order.payment_status !== 'paid'));

        if (visibleOrders.length > 0) {
          // Fetch all order items for these orders
          const orderIds = visibleOrders.map(o => o.id);
          const { data: itemsData } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds);

          // Fetch order item addons for all items
          const itemIds = (itemsData || []).map(i => i.id);
          let addonsData: OrderItemAddon[] = [];
          if (itemIds.length > 0) {
            const { data: addonsResult } = await supabase
              .from('order_item_addons')
              .select('*')
              .in('order_item_id', itemIds);
            addonsData = (addonsResult || []) as OrderItemAddon[];
          }

          // Fetch customer profiles for all unique user_ids
          const userIds = [...new Set(ordersData.map(o => o.user_id).filter(Boolean))] as string[];
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('user_id, full_name, phone')
            .in('user_id', userIds);

          // Map items, addons, customer profiles, and packages to their orders
          // Fetch order packages
          const { data: packagesData } = await supabase
            .from('order_packages')
            .select('*')
            .in('order_id', orderIds)
            .order('sort_order');

            const ordersWithItems: OrderWithItems[] = visibleOrders.map(order => {
            const customerProfile = profilesData?.find(p => p.user_id === order.user_id);
            const orderItems: OrderItemWithAddons[] = (itemsData || [])
              .filter(item => item.order_id === order.id)
              .map(item => ({
                ...item,
                addons: addonsData.filter(a => a.order_item_id === item.id),
              }));
            const orderPackages = (packagesData || []).filter(p => p.order_id === order.id) as OrderPackage[];
            return {
              ...order,
              items: orderItems,
              packages: orderPackages.length > 0 ? orderPackages : undefined,
              customer: customerProfile ? {
                full_name: customerProfile.full_name || order.receiver_name,
                phone: customerProfile.phone || order.receiver_phone
              } : {
                full_name: order.receiver_name,
                phone: order.receiver_phone
              }
            };
          });

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

  const generateConfirmationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    const order = orders.find(o => o.id === orderId);

    // Block start of preparation while pharmacist review is still pending
    if (newStatus === 'preparing' && (order as any)?.pharmacy_review_status === 'pending') {
      toast({
        title: 'Awaiting pharmacist review',
        description: 'You can start preparing only after all prescription items are approved.',
        variant: 'destructive',
      });
      return;
    }

    // If setting to "preparing" and prep time is enabled, show the prep time dialog instead
    if (newStatus === 'preparing' && prepTimeSettings.enabled) {
      if (order) {
        setPrepTimeDialog({ open: true, order });
        return;
      }
    }


    try {
      const order = orders.find(o => o.id === orderId);
      const updateData: any = { status: newStatus };

      // Generate confirmation code for self-pickup orders when they become ready
      if (newStatus === 'ready_for_pickup' && order?.delivery_type === 'self_pickup') {
        updateData.confirmation_code = generateConfirmationCode();
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) throw error;

      // Stop sound immediately — the useEffect on orders will restart if needed
      stopRepeating();

      toast({ title: `Order updated to ${statusConfig[newStatus].label}` });
      await fetchData();
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
    ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'searching_for_rider', 'assigned', 'picked_up', 'on_the_way'].includes(o.status)
  );
  const completedOrders = orders.filter((o) =>
    ['delivered', 'cancelled'].includes(o.status)
  );

  const completedTotalPages = Math.ceil(completedOrders.length / ITEMS_PER_PAGE);
  const paginatedCompleted = useMemo(() => {
    const start = (completedPage - 1) * ITEMS_PER_PAGE;
    return completedOrders.slice(start, start + ITEMS_PER_PAGE);
  }, [completedOrders, completedPage]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  if (authLoading || loading || permLoading) {
    return (
      <VendorLayout onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </VendorLayout>
    );
  }

  if (!hasPermission('process_orders')) {
    return (
      <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <AccessDenied message="You don't have permission to manage orders." />
      </VendorLayout>
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

  const handleRefundItem = async (item: OrderItemWithAddons, orderNumber: string) => {
    const itemAny = item as any;
    if (itemAny.is_refunded) return;
    const ok = confirm(
      `Refund "${item.product_name}" (₦${Number(item.total_price).toLocaleString()}) to the customer and mark this menu item as Unavailable?\n\nOrder #${orderNumber}`
    );
    if (!ok) return;
    try {
      const { data, error } = await supabase.functions.invoke('vendor-refund-item', {
        body: { orderItemId: item.id, action: 'refund', reason: 'Item unavailable' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'Refund processed',
        description: `₦${Number((data as any).refund_amount).toLocaleString()} refunded to customer wallet. Item marked unavailable.`,
      });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Refund failed', description: err.message, variant: 'destructive' });
    }
  };

  const handleRefundAddon = async (addon: any, orderNumber: string) => {
    if (addon.is_refunded) return;
    const ok = confirm(
      `Refund add-on "${addon.addon_item_name}" to the customer?\n\nOrder #${orderNumber}`
    );
    if (!ok) return;
    try {
      const { data, error } = await supabase.functions.invoke('vendor-refund-item', {
        body: { addonId: addon.id, action: 'refund', reason: 'Add-on unavailable' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'Add-on refunded',
        description: `₦${Number((data as any).refund_amount).toLocaleString()} refunded to customer wallet.`,
      });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Refund failed', description: err.message, variant: 'destructive' });
    }
  };

  const openSubstitute = (scope: 'item' | 'addon', id: string, originalName: string, originalPrice: number, orderNumber: string, totalQuantity: number) => {
    setSubForm({ name: '', note: '', refund: '', matchedPrice: null, quantity: String(Math.max(1, totalQuantity || 1)) });
    setSubstituteDialog({ open: true, scope, id, originalName, originalPrice, orderNumber, totalQuantity: Math.max(1, totalQuantity || 1) });
  };

  const submitSubstitute = async () => {
    if (!substituteDialog) return;
    if (!subForm.name.trim()) {
      toast({ title: 'Substitute name required', variant: 'destructive' });
      return;
    }
    // Full-line replace for both item and addon: subQty is the REPLACEMENT
    // quantity — unbounded by parent line quantity. Math mirrors items.
    const rawQty = Math.max(1, parseInt(subForm.quantity || '1', 10) || 1);
    const subQty = rawQty;
    setSubSubmitting(true);
    try {
      const body: any = {
        action: 'substitute',
        substituteName: subForm.name.trim(),
        substituteNote: subForm.note.trim() || undefined,
        substituteRefundAmount: subForm.refund ? Number(subForm.refund) : 0,
        substituteQuantity: subQty,
      };
      if (substituteDialog.scope === 'item') body.orderItemId = substituteDialog.id;
      else body.addonId = substituteDialog.id;

      const { data, error } = await supabase.functions.invoke('vendor-refund-item', { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'Substitute applied',
        description: (data as any).refund_amount > 0
          ? `Customer notified. ₦${Number((data as any).refund_amount).toLocaleString()} partial refund issued.`
          : 'Customer notified in chat (same price, no refund).',
      });
      setSubstituteDialog(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Substitute failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubSubmitting(false);
    }
  };


  const renderItemContent = (item: OrderItemWithAddons, orderNumber?: string) => {
    const itemAny = item as any;
    const isRefunded = !!itemAny.is_refunded;
    return (
    <>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={cn("font-medium text-foreground", isRefunded && "line-through opacity-60")}>
              {item.quantity}x {item.product_name}
            </p>
            {itemAny.is_free_meal_item && (
              <span className="inline-flex items-center gap-0.5 bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30 rounded-full px-1.5 py-0 text-[10px] font-semibold">
                🎁 Free Meal
              </span>
            )}
            {isRefunded && (
              <span className="inline-flex items-center bg-destructive/15 text-destructive border border-destructive/30 rounded-full px-1.5 py-0 text-[10px] font-semibold">
                Refunded
              </span>
            )}
          </div>
          {item.special_instructions && (
            <p className="text-xs text-primary/80 mt-0.5">
              🛠 {item.special_instructions}
            </p>
          )}
          {item.calories && item.calories > 0 && (
            <p className="text-xs text-muted-foreground">{item.calories} cal</p>
          )}
          {!isRefunded && orderNumber && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRefundItem(item, orderNumber)}
                className="h-7 px-2.5 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <RefreshCcw className="w-3 h-3" />
                Refund item
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSubstitute('item', item.id, item.product_name, Number((item as any).unit_price ?? (Number(item.total_price) / Math.max(1, item.quantity))), orderNumber, Number(item.quantity || 1))}
                className="h-7 px-2.5 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
              >
                <Repeat className="w-3 h-3" />
                Offer substitute
              </Button>
            </div>
          )}
          {(item as any).substituted_with && (
            <p className="mt-1 text-[11px] text-primary">
              🔄 Substituted with <strong>{(item as any).substituted_with}</strong>
              {(item as any).substitute_note ? ` — ${(item as any).substitute_note}` : ''}
            </p>
          )}
        </div>
        <p className={cn("font-medium text-foreground", isRefunded && "line-through opacity-60")}>
          ₦{Number(item.total_price).toLocaleString()}
        </p>
      </div>
      {item.addons && item.addons.length > 0 && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-primary/30 pl-3">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Add-ons:</p>
          {item.addons.map((addon) => {
            const a = addon as any;
            const addonRefunded = !!a.is_refunded;
            return (
              <div key={addon.id} className="text-xs">
                <div className="flex justify-between items-center">
                  <span className={cn("text-foreground flex items-center gap-1.5", addonRefunded && "line-through opacity-60")}>
                    {addon.image_url && (
                      <img src={addon.image_url} alt={addon.addon_item_name} className="w-6 h-6 rounded object-cover shrink-0" />
                    )}
                    + {addon.addon_item_name}
                    {addon.calories && addon.calories > 0 && (
                      <span className="text-muted-foreground ml-1">({addon.calories} cal)</span>
                    )}
                    {addonRefunded && (
                      <span className="inline-flex items-center bg-destructive/15 text-destructive border border-destructive/30 rounded-full px-1.5 py-0 text-[10px] font-semibold">
                        Refunded
                      </span>
                    )}
                  </span>
                  {addon.additional_price > 0 && (
                    <span className={cn("text-primary font-medium", addonRefunded && "line-through opacity-60")}>
                      +₦{Number(addon.additional_price).toLocaleString()}
                    </span>
                  )}
                </div>
                {!addonRefunded && !isRefunded && orderNumber && (
                  <div className="flex flex-wrap gap-2 mt-1.5 ml-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRefundAddon(addon, orderNumber)}
                      className="h-6 px-2 text-[11px] gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <RefreshCcw className="w-2.5 h-2.5" />
                      Refund add-on
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openSubstitute('addon', addon.id, addon.addon_item_name, Number(addon.additional_price || 0), orderNumber, Number(item.quantity || 1))}
                      className="h-6 px-2 text-[11px] gap-1 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <Repeat className="w-2.5 h-2.5" />
                      Offer substitute
                    </Button>
                  </div>
                )}
                {a.substituted_with && (
                  <p className="ml-1 text-[10px] text-primary">
                    🔄 Substituted with <strong>{a.substituted_with}</strong>
                    {a.substitute_note ? ` — ${a.substitute_note}` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
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
              <p className="font-semibold text-foreground">
                {order.order_number}
                {order.customer?.full_name && (
                  <span className="text-muted-foreground font-normal"> • {order.customer.full_name}</span>
                )}
              </p>
              {order.customer?.phone && (
                <p className="text-xs text-primary font-medium">{order.customer.phone}</p>
              )}
              <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Always-visible rider action for ready/searching orders */}
              {order.delivery_type !== 'self_pickup' &&
                !order.rider_id &&
                (order.status === 'ready_for_pickup' || order.status === 'searching_for_rider') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1"
                    onClick={() => setRiderAssignDialog({ open: true, order })}
                  >
                    <Bike className="w-4 h-4" />
                    Assign / Dispatch
                  </Button>
                )}

              <Badge className={`${status.color} border-0`}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {status.label}
              </Badge>
            </div>
          </div>

          {/* Order Items Preview */}
          <Collapsible open={isExpanded} onOpenChange={() => toggleOrderExpanded(order.id)}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors mb-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">
                    {order.items.length} item{order.items.length !== 1 ? 's' : ''} in order
                    {order.packages && order.packages.length > 1 && (
                      <span className="ml-1 text-primary">• {order.packages.length} packs</span>
                    )}
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
                {order.packages && order.packages.length > 1 ? (
                  // Multi-package view - grouped by recipient
                  order.packages.map((pkg) => {
                    const pkgItems = order.items.filter(i => (i as any).package_id === pkg.id);
                    return (
                      <div key={pkg.id} className="space-y-2">
                        <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                          <Package className="w-4 h-4 text-primary" />
                          <span className="text-sm font-bold text-primary">
                            Pack {pkg.sort_order + 1} — {pkg.recipient_name}
                          </span>
                        </div>
                        {pkg.note && (
                          <p className="text-xs text-muted-foreground bg-secondary/50 rounded px-3 py-1 ml-2">
                            📝 {pkg.note}
                          </p>
                        )}
                        {pkgItems.map((item) => (
                          <div key={item.id} className="text-sm ml-2">
                            {renderItemContent(item, order.order_number)}
                          </div>
                        ))}
                      </div>
                    );
                  })
                ) : order.items.length > 0 ? (
                  // Single package or legacy view
                  order.items.map((item) => (
                    <div key={item.id} className="text-sm">
                      {renderItemContent(item, order.order_number)}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No items found
                  </p>
                )}
                
                {/* Order Summary - Vendors only see their revenue (subtotal minus discounts) */}
                <div className="border-t border-border pt-2 mt-2 space-y-1">
                  {order.packaging_fee && Number(order.packaging_fee) > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" /> Takeaway Pack
                      </span>
                      <span>₦{Number(order.packaging_fee).toLocaleString()}</span>
                    </div>
                  )}
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

          {/* Pharmacist review banner */}
          {order.delivery_instructions && (
            <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 text-xs font-medium flex items-start gap-2 whitespace-pre-wrap">
              <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{order.delivery_instructions}</span>
            </div>
          )}

          {/* Pharmacist review banner */}
          {(order as any).pharmacy_review_status === 'pending' && (
            <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-warning/10 text-warning border border-warning/30 text-xs font-medium flex items-center gap-2">
              ⏳ Awaiting pharmacist review — prescription items must be approved before you can start preparing this order.
            </div>
          )}
          {(order as any).pharmacy_review_status === 'partially_rejected' && (
            <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/30 text-xs font-medium">
              Some prescription items were rejected and refunded. Prepare only approved items.
            </div>
          )}

          {/* Prep time countdown for preparing orders */}
          {order.status === 'preparing' && order.estimated_delivery_at && (
            <PrepCountdown estimatedAt={order.estimated_delivery_at} prepMinutes={order.prep_minutes} />
          )}


          {/* Food proof photo upload for preparing/ready orders */}
          {['preparing', 'ready_for_pickup'].includes(order.status) && vendor && (
            <div className="mb-3">
              <OrderProofPhotoUpload
                orderId={order.id}
                vendorId={vendor.id}
                orderStatus={order.status}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {order.total_calories ? `${order.total_calories} cal • ` : ''}
                ₦{Number(order.subtotal).toLocaleString()}
              </p>
              {/* Show delivery type indicator */}
              {order.delivery_type === 'self_pickup' ? (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <Store className="w-3 h-3" /> Carryout
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
                      disabled={nextStatus === 'preparing' && (order as any).pharmacy_review_status === 'pending'}
                    >
                      {nextStatus === 'preparing' && (order as any).pharmacy_review_status === 'pending'
                        ? 'Awaiting pharmacist review'
                        : `Mark as ${statusConfig[nextStatus].label}`}
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setCancelDialog({ open: true, order })}
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
                      disabled={nextStatus === 'preparing' && (order as any).pharmacy_review_status === 'pending'}
                    >
                      {nextStatus === 'preparing' && (order as any).pharmacy_review_status === 'pending'
                        ? 'Awaiting pharmacist review'
                        : `Mark as ${statusConfig[nextStatus].label}`}
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setCancelDialog({ open: true, order })}
                  >
                    Cancel Order
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Manual Rider Assignment - Show when order is ready but no rider yet */}
        {order.delivery_type !== 'self_pickup' && 
         order.status === 'ready_for_pickup' && 
         !order.rider_id && (
          <div className="px-4 pb-4">
            {(outletData?.latitude && outletData?.longitude) || (vendor?.latitude && vendor?.longitude) ? (
              <ManualRiderAssignment 
                orderId={order.id}
                orderNumber={order.order_number}
                vendorId={order.vendor_id}
                vendorLat={outletData?.latitude || vendor!.latitude!}
                vendorLng={outletData?.longitude || vendor!.longitude!}
                onAssigned={fetchData}
              />
            ) : (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-4">
                  <p className="text-sm text-warning">
                    ⚠️ Set your store location in Settings to assign riders
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Dispatch Status - Show when actively searching for platform rider */}
        {order.delivery_type !== 'self_pickup' && 
         order.status === 'searching_for_rider' && 
         !order.rider_id && 
         showManualAssignForOrder !== order.id && (
          <div className="px-4 pb-4">
            <DispatchStatus 
              orderId={order.id} 
              orderNumber={order.order_number}
              vendorId={order.vendor_id}
              vendorLat={outletData?.latitude || vendor?.latitude}
              vendorLng={outletData?.longitude || vendor?.longitude}
              onRiderAssigned={fetchData}
              onShowManualAssign={() => setShowManualAssignForOrder(order.id)}
            />
          </div>
        )}

        {/* Manual Rider Assignment - Show when vendor clicks "Assign Manually" from dispatch status */}
        {order.delivery_type !== 'self_pickup' && 
         order.status === 'searching_for_rider' && 
         !order.rider_id && 
          showManualAssignForOrder === order.id &&
         (outletData?.latitude || vendor?.latitude) && 
         (outletData?.longitude || vendor?.longitude) && (
          <div className="px-4 pb-4">
            <ManualRiderAssignment 
              orderId={order.id}
              orderNumber={order.order_number}
              vendorId={order.vendor_id}
              vendorLat={outletData?.latitude || vendor!.latitude!}
              vendorLng={outletData?.longitude || vendor!.longitude!}
              onAssigned={() => {
                setShowManualAssignForOrder(null);
                fetchData();
              }}
            />
          </div>
        )}

        {/* Rider Info - Show when a rider is assigned (any status after assignment) */}
        {order.delivery_type !== 'self_pickup' && order.rider_id && (
          <div className="px-4 pb-4">
            <OrderRiderInfo riderId={order.rider_id} orderStatus={order.status} />
          </div>
        )}

        {/* Chat with customer - available during active orders */}
        {['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'].includes(order.status) && (
          <div className="px-4 pb-4">
            <VendorOrderChat
              orderId={order.id}
              orderNumber={order.order_number}
              vendorId={order.vendor_id}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
      <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Orders</h1>
              <p className="text-muted-foreground">
                {activeOrders.length} active • {completedOrders.length} completed
              </p>
            </div>
            {/* Store Open/Close Toggle */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border w-fit">
              <Store className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{vendor?.is_open ? 'Open' : 'Closed'}</span>
              <Switch
                checked={vendor?.is_open ?? true}
                onCheckedChange={async (checked) => {
                  if (!vendor) return;
                  const { error } = await supabase
                    .from('vendors')
                    .update({ is_open: checked })
                    .eq('id', vendor.id);
                  if (!error) {
                    setVendor({ ...vendor, is_open: checked });
                    toast({ title: checked ? 'Store is now open' : 'Store is now closed' });
                  }
                }}
              />
            </div>
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
                  {paginatedCompleted.map(renderOrderCard)}
                  <PaginationControls
                    currentPage={completedPage}
                    totalPages={completedTotalPages}
                    onPageChange={setCompletedPage}
                    totalItems={completedOrders.length}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
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

          {/* Cancel Order Dialog */}
          {cancelDialog.order && (
            <CancelOrderDialog
              open={cancelDialog.open}
              onOpenChange={(open) => setCancelDialog({ ...cancelDialog, open })}
              orderId={cancelDialog.order.id}
              orderNumber={cancelDialog.order.order_number}
              orderTotal={Number(cancelDialog.order.total)}
              paymentStatus={cancelDialog.order.payment_status}
              onCancelled={() => {
                fetchData();
                setCancelDialog({ open: false, order: null });
              }}
            />
          )}

          {/* Prep Time Dialog */}
          {prepTimeDialog.order && vendor && (
            <PrepTimeDialog
              open={prepTimeDialog.open}
              onOpenChange={(open) => setPrepTimeDialog({ ...prepTimeDialog, open })}
              orderId={prepTimeDialog.order.id}
              orderNumber={prepTimeDialog.order.order_number}
              vendorCategory={vendor.category || 'restaurant'}
              prepTimeOptions={
                vendor.category === 'restaurant'
                  ? prepTimeSettings.restaurantOptions
                  : prepTimeSettings.otherOptions
              }
              onConfirmed={() => {
                stopRepeating();
                fetchData();
                setPrepTimeDialog({ open: false, order: null });
              }}
            />
          )}

          {/* Rider assignment / dispatch dialog */}
          <RiderAssignmentDialog
            open={riderAssignDialog.open}
            onOpenChange={(open) => setRiderAssignDialog((prev) => ({ ...prev, open }))}
            order={riderAssignDialog.order}
            vendor={vendor}
            onAssigned={() => {
              fetchData();
              setRiderAssignDialog({ open: false, order: null });
            }}
          />

          {/* Substitute item / add-on dialog */}
          <Dialog open={!!substituteDialog?.open} onOpenChange={(o) => !o && setSubstituteDialog(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Offer substitute</DialogTitle>
                <DialogDescription>
                  Replace <strong>{substituteDialog?.originalName}</strong> in order #{substituteDialog?.orderNumber} with something else.
                  The customer will be notified in chat.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label htmlFor="sub-name">Replacement name *</Label>
                  <Input
                    id="sub-name"
                    placeholder="Start typing a menu item…"
                    value={subForm.name}
                    onChange={(e) => setSubForm((p) => ({ ...p, name: e.target.value, matchedPrice: null }))}
                    autoComplete="off"
                  />
                  {/* Autocomplete suggestions from vendor's menu */}
                  {(() => {
                    const q = subForm.name.trim().toLowerCase();
                    if (!q || q.length < 1 || subForm.matchedPrice !== null) return null;
                    const orig = substituteDialog?.originalPrice || 0;
                    const lineQty = substituteDialog?.totalQuantity || 1;
                    const rawQ = Math.max(1, parseInt(subForm.quantity || '1', 10) || 1);
                    const subQty = rawQ;
                    const matches = menuOptions
                      .filter((m) => m.is_available && m.name.toLowerCase().includes(q) && m.name.toLowerCase() !== (substituteDialog?.originalName || '').toLowerCase())
                      .slice(0, 6);
                    if (matches.length === 0) {
                      return (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                          ⚠️ No matching menu item. Type the name <strong>carefully</strong>, or proceed with this custom name if it's not on your menu.
                        </p>
                      );
                    }
                    return (
                      <div className="border rounded-md divide-y bg-background max-h-48 overflow-y-auto shadow-sm">
                        {matches.map((m) => {
                          // Full-line replace (item AND addon):
                          // refund = (lineQty × origUnit) − (subQty × newUnit)
                          const totalRefund = (lineQty * orig) - (subQty * m.price);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              className="w-full flex justify-between items-center px-2 py-1.5 text-left hover:bg-muted text-xs"
                              onClick={() => {
                                setSubForm((p) => ({
                                  ...p,
                                  name: m.name,
                                  refund: totalRefund > 0 ? String(totalRefund) : '',
                                  matchedPrice: m.price,
                                }));
                              }}
                            >
                              <span className="font-medium">{m.name}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-muted-foreground">₦{m.price.toLocaleString()}</span>
                                {orig > 0 && (
                                  totalRefund > 0 ? <span className="text-green-700">↓ ₦{totalRefund.toLocaleString()} refund</span>
                                  : totalRefund < 0 ? <span className="text-red-700">+₦{Math.abs(totalRefund).toLocaleString()} more</span>
                                  : <span className="text-muted-foreground">same total</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {subForm.matchedPrice !== null && substituteDialog && (() => {
                    const lineQty = substituteDialog.totalQuantity;
                    const rawQ = Math.max(1, parseInt(subForm.quantity || '1', 10) || 1);
                    const subQty = rawQ;
                    const origTotal = lineQty * substituteDialog.originalPrice;
                    const subTotal = subQty * subForm.matchedPrice;
                    return (
                      <p className="text-[11px] text-primary">
                        Replacing {lineQty} × {substituteDialog.originalName} (₦{origTotal.toLocaleString()}) with {subQty} × {subForm.name} (₦{subTotal.toLocaleString()}).
                        {subTotal > origTotal && (
                          <span className="text-red-700"> Replacement costs more; refund kept at 0 (extra charge isn't auto-billed).</span>
                        )}
                      </p>
                    );
                  })()}
                </div>

                {substituteDialog && (
                  <div className="space-y-1">
                    <Label htmlFor="sub-qty">
                      {substituteDialog.scope === 'item'
                        ? 'Quantity of replacement item'
                        : `Quantity to substitute (of ${substituteDialog.totalQuantity} parent portion(s))`}
                    </Label>
                    <Input
                      id="sub-qty"
                      type="number"
                      min="1"
                      {...(substituteDialog.scope === 'addon' ? { max: substituteDialog.totalQuantity } : {})}
                      step="1"
                      value={subForm.quantity}
                      onChange={(e) => {
                        const newQty = e.target.value;
                        setSubForm((p) => {
                          if (p.matchedPrice !== null && substituteDialog) {
                            const lineQty = substituteDialog.totalQuantity;
                            const raw = Math.max(1, parseInt(newQty || '1', 10) || 1);
                            const q = substituteDialog.scope === 'addon' ? Math.min(lineQty, raw) : raw;
                            const total = substituteDialog.scope === 'item'
                              ? (lineQty * substituteDialog.originalPrice) - (q * p.matchedPrice)
                              : (substituteDialog.originalPrice - p.matchedPrice) * q;
                            return { ...p, quantity: newQty, refund: total > 0 ? String(total) : '' };
                          }
                          return { ...p, quantity: newQty };
                        });
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {substituteDialog.scope === 'addon' ? (
                        <>The other {Math.max(0, substituteDialog.totalQuantity - (parseInt(subForm.quantity || '1', 10) || 1))} portion(s) keep the original <strong>{substituteDialog.originalName}</strong> add-on. The parent line will be split so only the swapped portions get the new add-on.</>
                      ) : (
                        <>The entire line of {substituteDialog.totalQuantity} × <strong>{substituteDialog.originalName}</strong> will be replaced with {Math.max(1, parseInt(subForm.quantity || '1', 10) || 1)} × the replacement item. Refund = original total − new total.</>
                      )}
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="sub-note">Note for customer (optional)</Label>
                  <Textarea
                    id="sub-note"
                    placeholder="e.g. similar portion, same protein"
                    rows={2}
                    value={subForm.note}
                    onChange={(e) => setSubForm((p) => ({ ...p, note: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub-refund">Total partial refund (₦) — leave 0 if same price</Label>
                  <Input
                    id="sub-refund"
                    type="number"
                    min="0"
                    step="50"
                    placeholder="0"
                    value={subForm.refund}
                    onChange={(e) => setSubForm((p) => ({ ...p, refund: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Auto-calculated as <em>original line total − replacement total</em> (e.g. 7×₦1,500 − 3×₦200 = ₦9,900). Override if needed. Credited to the customer's wallet.
                  </p>
                </div>

              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSubstituteDialog(null)} disabled={subSubmitting}>
                  Cancel
                </Button>
                <Button onClick={submitSubstitute} disabled={subSubmitting || !subForm.name.trim()}>
                  {subSubmitting ? 'Applying…' : 'Apply substitute'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      </div>
    </VendorLayout>
  );
}
