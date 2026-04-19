import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Clock, Store, User, Bike, Phone, Star, MapPin,
  AlertTriangle, CheckCircle2, Package, Search, Globe, Gift,
  RefreshCw, ArrowRight, Repeat,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { OrderPhotoEvidence } from '@/components/admin/OrderPhotoEvidence';

import { restoreFreeMealOnCancel } from '@/lib/restoreFreeMealOnCancel';
/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Order {
  id: string;
  order_number: string;
  status: string;
  delivery_type: string;
  rider_id: string | null;
  vendor_id: string;
  user_id: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  discount: number;
  delivery_address: string;
  delivery_address_text: string | null;
  delivery_instructions: string | null;
  created_at: string;
  updated_at: string;
  payment_status: string;
  outlet_id: string | null;
  packaging_fee: number;
  environment: string;
}

interface VendorInfo {
  name: string;
  phone: string | null;
  address: string | null;
  outletName: string | null;
  outletAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface CustomerInfo {
  name: string;
  phone: string | null;
  email: string | null;
}

interface RiderInfo {
  userId: string;
  name: string;
  phone: string | null;
  rating: number;
  totalDeliveries: number;
}

interface NearbyRider {
  id: string;
  user_id: string;
  name: string;
  rating: number;
  totalDeliveries: number;
  distance: number;
  currentOrderStatus: string | null;
  vehicleType: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onUpdated: () => void;
}

/* ------------------------------------------------------------------ */
/*  Status pipeline                                                    */
/* ------------------------------------------------------------------ */

const ORDER_STEPS = [
  { key: 'pending', label: 'Order Placed', icon: Package },
  { key: 'confirmed', label: 'Vendor Confirmed', icon: CheckCircle2 },
  { key: 'preparing', label: 'Preparing', icon: Store },
  { key: 'searching_for_rider', label: 'Finding Rider', icon: Search },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: Package },
  { key: 'picked_up', label: 'Picked Up', icon: Bike },
  { key: 'on_the_way', label: 'On the Way', icon: Bike },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

const VENDOR_RESPONSE_THRESHOLD_SECONDS = 300; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AdminOrderTrackingDialog({ open, onOpenChange, order, onUpdated }: Props) {
  const { toast } = useToast();

  // Data
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [rider, setRider] = useState<RiderInfo | null>(null);
  const [liveOrder, setLiveOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<{ product_name: string; quantity: number; special_instructions: string | null; unit_price?: number; total_price?: number; is_free_meal_item?: boolean; original_unit_price?: number; free_qty?: number | null; order_item_addons?: { addon_group_name: string; addon_item_name: string; additional_price: number }[] }[]>([]);
  const [completing, setCompleting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [orderFinancials, setOrderFinancials] = useState<{
    vendor_payout: number;
    vendor_commission_amount: number;
    rider_commission_amount: number | null;
    rider_share: number | null;
    company_revenue: number;
    service_fee_amount: number | null;
  } | null>(null);

  // Vendor countdown
  const [vendorElapsed, setVendorElapsed] = useState(0);

  // Manual assignment
  const [nearbyRiders, setNearbyRiders] = useState<NearbyRider[]>([]);
  const [loadingRiders, setLoadingRiders] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [rescueBonus, setRescueBonus] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [changingDeliveryType, setChangingDeliveryType] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const activeOrder = liveOrder || order;
  const hasFreeMealItems = orderItems.some(item => item.is_free_meal_item);
  const isFreeMealOrder = activeOrder ? Boolean((activeOrder as any).is_free_meal || (activeOrder as any).free_meal_promo_id || hasFreeMealItems) : false;
  const effectiveFoodSubtotal = isFreeMealOrder
    ? Number((activeOrder as any)?.menu_subtotal || activeOrder?.subtotal || 0)
    : Number(activeOrder?.subtotal || 0);
  const inferredFreeMealValue = orderItems.reduce((sum, item) => {
    if (!item.is_free_meal_item) return sum;
    const unit = Number(item.original_unit_price || item.unit_price || 0);
    const freeQty = item.free_qty ?? item.quantity; // only count platform-sponsored qty
    return sum + unit * freeQty;
  }, 0);
  const freeMealValue = Number((activeOrder as any)?.free_meal_value || inferredFreeMealValue || 0);

  /* ---------- fetch vendor, customer, rider info ---------- */

  const fetchDetails = useCallback(async (o: Order) => {
    // Vendor
    const { data: v } = await supabase
      .from('vendors')
      .select('name, phone, address, latitude, longitude')
      .eq('id', o.vendor_id)
      .maybeSingle();

    let outletName: string | null = null;
    let outletAddr: string | null = null;
    let oLat = v?.latitude ?? null;
    let oLng = v?.longitude ?? null;

    if (o.outlet_id) {
      const { data: outlet } = await supabase
        .from('vendor_outlets')
        .select('outlet_surname, address, latitude, longitude')
        .eq('id', o.outlet_id)
        .maybeSingle();
      if (outlet) {
        outletName = outlet.outlet_surname;
        outletAddr = outlet.address;
        oLat = outlet.latitude ?? oLat;
        oLng = outlet.longitude ?? oLng;
      }
    }

    setVendor({
      name: v?.name || 'Unknown',
      phone: v?.phone || null,
      address: v?.address || null,
      outletName,
      outletAddress: outletAddr,
      latitude: oLat,
      longitude: oLng,
    });

    // Customer
    const { data: cp } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('user_id', o.user_id)
      .maybeSingle();

    const { data: authUser } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', o.user_id)
      .maybeSingle();

    setCustomer({
      name: cp?.full_name || 'Customer',
      phone: cp?.phone || null,
      email: null,
    });

    // Rider (if assigned)
    if (o.rider_id) {
      fetchRider(o.rider_id);
    } else {
      setRider(null);
    }

    // Order financials (vendor payout, rider share, commissions)
    const { data: fin } = await supabase
      .from('order_financials')
      .select('vendor_payout, vendor_commission_amount, rider_commission_amount, company_revenue, service_fee_amount')
      .eq('order_id', o.id)
      .maybeSingle();

    if (fin) {
      // Also get rider share from wallet_transactions
      const { data: riderTx } = await supabase
        .from('wallet_transactions')
        .select('amount')
        .eq('order_id', o.id)
        .in('category', ['rider_share', 'vendor_rider_share', 'delivery_company_share'])
        .eq('transaction_type', 'credit')
        .eq('status', 'completed')
        .limit(1)
        .maybeSingle();

      setOrderFinancials({
        vendor_payout: fin.vendor_payout,
        vendor_commission_amount: fin.vendor_commission_amount,
        rider_commission_amount: fin.rider_commission_amount,
        rider_share: riderTx?.amount ?? null,
        company_revenue: fin.company_revenue,
        service_fee_amount: fin.service_fee_amount,
      });
    } else {
      setOrderFinancials(null);
    }
  }, []);

  const fetchRider = async (riderId: string) => {
    const { data: rp } = await supabase
      .from('rider_profiles')
      .select('rating, total_deliveries')
      .eq('user_id', riderId)
      .maybeSingle();
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('user_id', riderId)
      .maybeSingle();

    setRider({
      userId: riderId,
      name: prof?.full_name || 'Rider',
      phone: prof?.phone || null,
      rating: rp?.rating || 0,
      totalDeliveries: rp?.total_deliveries || 0,
    });
  };

  /* ---------- initial load + realtime ---------- */

  useEffect(() => {
    if (!order || !open) return;
    setLiveOrder(order as Order);
    fetchDetails(order as Order);
    fetchOrderItems(order.id);
    setSelectedRiderId('');
    setRescueBonus('');
    setNearbyRiders([]);
  }, [order, open, fetchDetails]);

  const fetchOrderItems = async (orderId: string) => {
    const { data: allItems } = await supabase
      .from('order_items')
      .select('id, product_name, quantity, special_instructions, unit_price, total_price, is_free_meal_item, original_unit_price, free_qty')
      .eq('order_id', orderId);

    if (!allItems || allItems.length === 0) {
      setOrderItems([]);
      return;
    }

    const ids = allItems.map(it => it.id);
    const { data: addons } = await supabase
      .from('order_item_addons')
      .select('order_item_id, addon_group_name, addon_item_name, additional_price')
      .in('order_item_id', ids);

    const addonMap = new Map<string, typeof addons>();
    addons?.forEach(a => {
      const existing = addonMap.get(a.order_item_id) || [];
      existing.push(a);
      addonMap.set(a.order_item_id, existing);
    });

    setOrderItems(allItems.map(it => ({
      product_name: it.product_name,
      quantity: it.quantity,
      special_instructions: it.special_instructions,
      unit_price: it.unit_price,
      total_price: it.total_price,
      is_free_meal_item: (it as any).is_free_meal_item || false,
      original_unit_price: (it as any).original_unit_price,
      free_qty: (it as any).free_qty ?? null,
      order_item_addons: (addonMap.get(it.id) || []).map(a => ({
        addon_group_name: a.addon_group_name,
        addon_item_name: a.addon_item_name,
        additional_price: a.additional_price,
      })),
    })));
  };

  const handleCompleteOrder = async () => {
    if (!activeOrder) return;
    setCompleting(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'delivered' as any, delivered_at: new Date().toISOString() })
        .eq('id', activeOrder.id);
      if (error) throw error;
      // Log calories for the customer
      try {
        await supabase.functions.invoke('log-order-calories', {
          body: { orderId: activeOrder.id }
        });
      } catch (calorieError) {
        console.error('Failed to log calories:', calorieError);
      }
      toast({ title: '✅ Order marked as delivered' });
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setCompleting(false);
    }
  };

  // realtime subscription
  useEffect(() => {
    if (!order || !open) return;
    const channel = supabase
      .channel(`admin-track-${order.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` }, (payload) => {
        const updated = payload.new as unknown as Order;
        setLiveOrder(updated);
        if (updated.rider_id && !rider) fetchRider(updated.rider_id);
        onUpdated();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [order?.id, open]);

  /* ---------- vendor countdown ---------- */

  useEffect(() => {
    if (!activeOrder) return;
    const status = activeOrder.status;
    if (status !== 'pending' && status !== 'confirmed') {
      setVendorElapsed(0);
      return;
    }

    const calc = () => {
      const created = new Date(activeOrder.created_at).getTime();
      setVendorElapsed(Math.floor((Date.now() - created) / 1000));
    };
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [activeOrder?.status, activeOrder?.created_at]);

  /* ---------- nearby rider search ---------- */

  const searchNearbyRiders = async () => {
    if (!vendor?.latitude || !vendor?.longitude) {
      toast({ title: 'Vendor location missing', variant: 'destructive' });
      return;
    }
    setLoadingRiders(true);
    try {
      // Fetch ALL online verified riders
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, rating, total_deliveries, vehicle_type')
        .eq('is_online', true)
        .eq('is_verified', true)
        .eq('is_email_verified', true);

      if (!riders?.length) { setNearbyRiders([]); return; }

      const userIds = riders.map((r) => r.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds);
      const nameMap = new Map(profiles?.map((p) => [p.user_id, p.full_name]) || []);

      // Check which riders currently have an active (non-delivered/cancelled) order
      const { data: activeOrders } = await supabase
        .from('orders')
        .select('rider_id, status')
        .in('rider_id', userIds)
        .not('status', 'in', '("delivered","cancelled")');

      const activeMap = new Map<string, string>();
      activeOrders?.forEach((ao) => {
        if (ao.rider_id) activeMap.set(ao.rider_id, ao.status);
      });

      const mapped: NearbyRider[] = riders
        .map((r) => {
          const rLat = r.current_latitude || r.preferred_latitude;
          const rLng = r.current_longitude || r.preferred_longitude;
          const dist = rLat && rLng ? haversineKm(vendor.latitude!, vendor.longitude!, rLat, rLng) : 999;
          return {
            id: r.id,
            user_id: r.user_id,
            name: nameMap.get(r.user_id) || 'Rider',
            rating: r.rating || 0,
            totalDeliveries: r.total_deliveries || 0,
            distance: dist,
            currentOrderStatus: activeMap.get(r.user_id) || null,
            vehicleType: r.vehicle_type,
          };
        })
        .filter((r) => r.distance <= 5) // within 5 km
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 20);

      setNearbyRiders(mapped);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRiders(false);
    }
  };

  /* ---------- assign rider ---------- */

  const handleAssignRider = async () => {
    if (!selectedRiderId || !activeOrder) return;
    setAssigning(true);
    try {
      const chosen = nearbyRiders.find((r) => r.id === selectedRiderId);
      if (!chosen) throw new Error('Rider not found');

      const { error } = await supabase.functions.invoke('assign-rider', {
        body: { orderId: activeOrder.id, riderId: chosen.user_id },
      });
      if (error) throw error;

      // Record rescue bonus if any
      const bonusVal = parseFloat(rescueBonus);
      if (bonusVal > 0) {
        // Get rider wallet
        const { data: riderWallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', chosen.user_id)
          .eq('wallet_type', 'rider')
          .maybeSingle();

        if (riderWallet) {
          await supabase.from('wallet_transactions').insert({
            wallet_type: 'rider',
            category: 'rescue_bonus',
            transaction_type: 'credit',
            amount: bonusVal,
            wallet_id: riderWallet.id,
            order_id: activeOrder.id,
            environment: activeOrder.environment || 'production',
            status: 'completed',
            notes: `Rescue bonus for order #${activeOrder.order_number}`,
          });

          // Credit rider balance
          const isTest = activeOrder.environment === 'development';
          if (isTest) {
            await supabase.rpc('admin_adjust_wallet_balance', {
              p_wallet_id: riderWallet.id,
              p_amount: bonusVal,
              p_adjust_type: 'credit',
              p_notes: `Rescue bonus for order #${activeOrder.order_number}`,
              p_environment: 'development',
            });
          } else {
            await supabase.rpc('admin_adjust_wallet_balance', {
              p_wallet_id: riderWallet.id,
              p_amount: bonusVal,
              p_adjust_type: 'credit',
              p_notes: `Rescue bonus for order #${activeOrder.order_number}`,
              p_environment: 'production',
            });
          }
        }
      }

      toast({ title: '✅ Rider assigned' + (bonusVal > 0 ? ` with ₦${bonusVal} rescue bonus` : '') });
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setAssigning(false);
    }
  };

  /* ---------- dispatch publicly ---------- */

  const handleDispatchPublic = async () => {
    if (!activeOrder) return;
    setDispatching(true);
    try {
      const { data, error } = await supabase.functions.invoke('dispatch-order', {
        body: { orderId: activeOrder.id, publicOnly: true },
      });
      if (error) throw error;
      toast({
        title: '🔔 Dispatched publicly',
        description: `Notifying ${data?.eligibleRiderCount || 0} nearby riders`,
      });
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setDispatching(false);
    }
  };

  /* ---------- derived state ---------- */

  const currentStepIndex = useMemo(() => {
    if (!activeOrder) return 0;
    const s = activeOrder.status;
    if (s === 'cancelled') return -1;
    if (s === 'assigned') return ORDER_STEPS.findIndex((st) => st.key === 'ready_for_pickup');
    const idx = ORDER_STEPS.findIndex((st) => st.key === s);
    return idx >= 0 ? idx : 0;
  }, [activeOrder?.status]);

  const progressPct = activeOrder?.status === 'cancelled' ? 0 : ((currentStepIndex + 1) / ORDER_STEPS.length) * 100;

  const vendorOverdue = vendorElapsed > VENDOR_RESPONSE_THRESHOLD_SECONDS && (activeOrder?.status === 'pending' || activeOrder?.status === 'confirmed');

  const needsRider =
    activeOrder &&
    activeOrder.delivery_type !== 'self_pickup' &&
    !activeOrder.rider_id &&
    ['searching_for_rider', 'ready_for_pickup', 'confirmed', 'preparing'].includes(activeOrder.status);

  if (!activeOrder) return null;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Order #{activeOrder.order_number}
            <Badge variant={activeOrder.status === 'cancelled' ? 'destructive' : 'secondary'} className="capitalize">
              {activeOrder.status.replace(/_/g, ' ')}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* ── Progress Timeline ── */}
        <div className="space-y-3">
          <Progress value={progressPct} className="h-2" />
          <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
            {ORDER_STEPS.map((step, i) => {
              const isActive = i <= currentStepIndex;
              const Icon = step.icon;
              return (
                <div key={step.key} className={`flex flex-col items-center gap-0.5 ${isActive ? 'text-primary font-medium' : ''}`}>
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground/40'}`} />
                  <span className="text-center leading-tight">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Vendor Countdown Alert ── */}
        {vendorOverdue && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="py-3 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Vendor hasn't updated this order</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(vendorElapsed)} elapsed since order was placed
                </p>
              </div>
              {vendor?.phone && (
                <a href={`tel:${vendor.phone}`}>
                  <Button size="sm" variant="destructive" className="gap-1">
                    <Phone className="w-3.5 h-3.5" /> Call Vendor
                  </Button>
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Vendor countdown (non-overdue) ── */}
        {!vendorOverdue && (activeOrder.status === 'pending' || activeOrder.status === 'confirmed') && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="py-3 flex items-center gap-3">
              <Clock className="w-5 h-5 text-warning shrink-0" />
              <div>
                <p className="text-sm font-medium">Waiting for vendor response</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(vendorElapsed)} elapsed • Alert at {Math.floor(VENDOR_RESPONSE_THRESHOLD_SECONDS / 60)} min
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Admin Manual Status Change ── */}
        {activeOrder.status !== 'delivered' && activeOrder.status !== 'cancelled' && (
          <Card className="border-orange-200 bg-orange-50/50">
            <CardContent className="py-3 px-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <RefreshCw className="w-4 h-4 text-orange-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Manual Status Override</p>
                    <p className="text-xs text-muted-foreground">
                      Current: <span className="capitalize">{activeOrder.status.replace(/_/g, ' ')}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={activeOrder.status}
                    onValueChange={async (newStatus) => {
                      if (newStatus === activeOrder.status) return;
                      const confirmMsg = `Change order status from "${activeOrder.status.replace(/_/g, ' ')}" to "${newStatus.replace(/_/g, ' ')}"?\n\nThis is a manual override and won't trigger financial operations.`;
                      if (!window.confirm(confirmMsg)) return;

                      setChangingStatus(true);
                      try {
                        const updateData: any = { status: newStatus, updated_at: new Date().toISOString() };
                        if (newStatus === 'delivered') {
                          updateData.delivered_at = new Date().toISOString();
                        }
                        const { error } = await supabase
                          .from('orders')
                          .update(updateData)
                          .eq('id', activeOrder.id);
                        if (error) throw error;
                        // Log calories when delivered
                        if (newStatus === 'delivered') {
                          try {
                            await supabase.functions.invoke('log-order-calories', {
                              body: { orderId: activeOrder.id }
                            });
                          } catch (calorieError) {
                            console.error('Failed to log calories:', calorieError);
                          }
                        }
                        // Restore free meal if cancelled
                        if (newStatus === 'cancelled') {
                          await restoreFreeMealOnCancel(activeOrder.id);
                        }
                        toast({ title: '✅ Status updated', description: `Order is now "${newStatus.replace(/_/g, ' ')}"` });
                        const { data: refreshed } = await supabase
                          .from('orders')
                          .select('*')
                          .eq('id', activeOrder.id)
                          .single();
                        if (refreshed) setLiveOrder(refreshed as unknown as Order);
                        onUpdated();
                      } catch (e: any) {
                        toast({ title: 'Error', description: e.message, variant: 'destructive' });
                      } finally {
                        setChangingStatus(false);
                      }
                    }}
                    disabled={changingStatus}
                  >
                    <SelectTrigger className="w-44 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="preparing">Preparing</SelectItem>
                      <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                      <SelectItem value="picked_up">Picked Up</SelectItem>
                      <SelectItem value="on_the_way">On the Way</SelectItem>
                      <SelectItem value="delivered">Delivered</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  {changingStatus && <Loader2 className="w-4 h-4 animate-spin text-orange-600" />}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                ⚠️ Manual override only — does not trigger financial settlements or notifications
              </p>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* ── Info Cards: Vendor + Customer ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Vendor */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                <Store className="w-3.5 h-3.5" /> Vendor
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-1">
              <p className="font-medium text-sm">
                {vendor?.name}{vendor?.outletName ? ` – ${vendor.outletName}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">{vendor?.outletAddress || vendor?.address || '—'}</p>
              {vendor?.phone && (
                <a href={`tel:${vendor.phone}`} className="text-xs text-primary flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {vendor.phone}
                </a>
              )}
            </CardContent>
          </Card>

          {/* Customer */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                <User className="w-3.5 h-3.5" /> Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-1">
              <p className="font-medium text-sm">{customer?.name || '—'}</p>
              <p className="text-xs text-muted-foreground">{activeOrder.delivery_address_text || activeOrder.delivery_address || '—'}</p>
              {activeOrder.delivery_instructions && (
                <p className="text-[11px] text-muted-foreground mt-0.5 italic">📝 {activeOrder.delivery_instructions}</p>
              )}
              {customer?.phone && (
                <a href={`tel:${customer.phone}`} className="text-xs text-primary flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {customer.phone}
                </a>
              )}
              {(activeOrder.delivery_address_text || activeOrder.delivery_address) && activeOrder.delivery_type !== 'self_pickup' && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeOrder.delivery_address_text || activeOrder.delivery_address || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <MapPin className="w-3 h-3" /> View on Google Maps
                </a>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Order Financials ── */}
        <Card>
          <CardContent className="py-3 px-4 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div><span className="text-muted-foreground">{isFreeMealOrder ? 'Food Subtotal' : 'Subtotal'}</span><p className="font-medium">₦{effectiveFoodSubtotal.toLocaleString()}</p></div>
              <div><span className="text-muted-foreground">Delivery Fee</span><p className="font-medium">₦{Number(activeOrder.delivery_fee || 0).toLocaleString()}</p></div>
              <div><span className="text-muted-foreground">Service Fee</span><p className="font-medium">₦{Number(activeOrder.service_fee || 0).toLocaleString()}</p></div>
              <div><span className="text-muted-foreground">Total</span><p className="font-semibold text-primary">₦{Number(activeOrder.total).toLocaleString()}</p></div>
            </div>

            {orderFinancials && (
              <>
                <Separator />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">After Platform Commission</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Vendor Payout</span>
                    <p className="font-semibold text-green-600">₦{Number(orderFinancials.vendor_payout).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Vendor Commission</span>
                    <p className="font-medium text-destructive">₦{Number(orderFinancials.vendor_commission_amount).toLocaleString()}</p>
                  </div>
                  {orderFinancials.rider_share !== null && (
                    <div>
                      <span className="text-muted-foreground">Rider Share</span>
                      <p className="font-semibold text-green-600">₦{Number(orderFinancials.rider_share).toLocaleString()}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Platform Revenue</span>
                    <p className="font-semibold text-primary">₦{Number(orderFinancials.company_revenue).toLocaleString()}</p>
                  </div>
                </div>
                {/* Recalculate Button */}
                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5"
                    disabled={recalculating}
                    onClick={async () => {
                      if (!activeOrder) return;
                      if (!window.confirm('Recalculate financials for this order? This will recompute vendor payout, commission, and platform revenue using current rules (platform absorbs promo discounts).')) return;
                      setRecalculating(true);
                      try {
                        // Get order details
                        const { data: ord } = await supabase
                          .from('orders')
                          .select('id, subtotal, discount, menu_subtotal, packaging_fee, service_fee, delivery_fee, vendor_id, promo_code, environment, order_number')
                          .eq('id', activeOrder.id)
                          .single();
                        if (!ord) throw new Error('Order not found');

                        const menuPrice = Number(ord.menu_subtotal || (Number(ord.subtotal) + Number(ord.discount || 0)));
                        const packagingFee = Number(ord.packaging_fee || 0);
                        const promoDiscount = Number(ord.discount || 0);
                        const serviceFee = Number(ord.service_fee || 0);

                        // Get commission rate
                        const { data: overrideData } = await supabase
                          .from('commission_overrides')
                          .select('percentage_value')
                          .eq('entity_type', 'vendor')
                          .eq('entity_id', ord.vendor_id)
                          .maybeSingle();

                        let commissionRate = 15;
                        if (overrideData?.percentage_value) {
                          commissionRate = Number(overrideData.percentage_value);
                        } else {
                          const { data: setting } = await supabase
                            .from('platform_settings')
                            .select('value')
                            .eq('key', 'default_vendor_commission_rate')
                            .maybeSingle();
                          if (setting) commissionRate = parseFloat(setting.value);
                        }

                        const grossCommission = Math.round(menuPrice * (commissionRate / 100) * 100) / 100;
                        const netCommission = Math.max(0, grossCommission - promoDiscount);
                        const vendorPayout = menuPrice - netCommission + packagingFee;
                        let companyRevenue = netCommission + serviceFee;
                        if (promoDiscount > grossCommission) {
                          companyRevenue -= (promoDiscount - grossCommission);
                        }

                        // Update order_financials
                        const { error: updateError } = await supabase
                          .from('order_financials')
                          .update({
                            menu_price: menuPrice,
                            vendor_commission_percentage: commissionRate,
                            vendor_commission_amount: netCommission,
                            promo_discount_amount: promoDiscount,
                            vendor_payout: vendorPayout,
                            company_revenue: companyRevenue,
                            revenue_status: companyRevenue > 0 ? 'profit' : companyRevenue === 0 ? 'break_even' : 'loss',
                            service_fee_amount: serviceFee,
                          })
                          .eq('order_id', activeOrder.id);

                        if (updateError) throw updateError;

                        // Refresh financials display
                        const { data: fin } = await supabase
                          .from('order_financials')
                          .select('vendor_payout, vendor_commission_amount, rider_commission_amount, company_revenue, service_fee_amount')
                          .eq('order_id', activeOrder.id)
                          .maybeSingle();

                        if (fin) {
                          const { data: riderTx } = await supabase
                            .from('wallet_transactions')
                            .select('amount')
                            .eq('order_id', activeOrder.id)
                            .in('category', ['rider_share', 'vendor_rider_share', 'delivery_company_share'])
                            .eq('transaction_type', 'credit')
                            .eq('status', 'completed')
                            .limit(1)
                            .maybeSingle();

                          setOrderFinancials({
                            vendor_payout: fin.vendor_payout,
                            vendor_commission_amount: fin.vendor_commission_amount,
                            rider_commission_amount: fin.rider_commission_amount,
                            rider_share: riderTx?.amount ?? null,
                            company_revenue: fin.company_revenue,
                            service_fee_amount: fin.service_fee_amount,
                          });
                        }

                        toast({ title: '✅ Financials recalculated', description: `Vendor payout: ₦${vendorPayout.toLocaleString()}, Platform: ₦${companyRevenue.toLocaleString()}` });
                      } catch (e: any) {
                        toast({ title: 'Error', description: e.message, variant: 'destructive' });
                      } finally {
                        setRecalculating(false);
                      }
                    }}
                  >
                    {recalculating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Recalculate
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Free Meal Info ── */}
        {isFreeMealOrder && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="py-3 px-4 space-y-1">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700 dark:text-green-400">Free Meal Order (Platform Sponsored)</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                <div>
                  <span className="text-muted-foreground">Free Meal Value</span>
                  <p className="font-semibold text-green-600">₦{freeMealValue.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Customer Paid</span>
                  <p className="font-medium">₦{Number(activeOrder.total).toLocaleString()}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                The vendor receives full food value. Platform absorbs the free meal cost from profit.
              </p>
            </CardContent>
          </Card>
        )}


        {/* ── Change Delivery Type ── */}
        {activeOrder.status !== 'delivered' && activeOrder.status !== 'cancelled' && (
          <Card>
            <CardContent className="py-3 px-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Repeat className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Delivery Method</p>
                    <p className="text-xs text-muted-foreground">
                      Currently: {(activeOrder.delivery_type || 'delivery').replace(/_/g, ' ')}
                      {activeOrder.delivery_type !== 'self_pickup' && Number(activeOrder.delivery_fee) > 0 && (
                        <span> • Fee: ₦{Number(activeOrder.delivery_fee).toLocaleString()}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={activeOrder.delivery_type || 'delivery'}
                    onValueChange={async (newType) => {
                      if (newType === (activeOrder.delivery_type || 'delivery')) return;
                      const isSwitchingToPickup = newType === 'self_pickup';
                      const fee = Number(activeOrder.delivery_fee) || 0;
                      const confirmMsg = isSwitchingToPickup
                        ? `Switch to Carryout? ₦${fee.toLocaleString()} delivery fee will be refunded to the customer's wallet.`
                        : `Switch to Delivery? The base delivery fee will be charged from the customer's wallet.`;
                      if (!window.confirm(confirmMsg)) return;

                      setChangingDeliveryType(true);
                      try {
                        const { data: sessionData } = await supabase.auth.getSession();
                        const accessToken = sessionData?.session?.access_token;
                        if (!accessToken) throw new Error('Not authenticated. Please sign in again.');
                        
                        const response = await fetch(
                          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/switch-delivery-type`,
                          {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${accessToken}`,
                              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                            },
                            body: JSON.stringify({ orderId: activeOrder.id, newDeliveryType: newType }),
                          }
                        );
                        const data = await response.json();
                        const error = !response.ok ? new Error(data?.message || 'Function failed') : null;
                        if (error) throw error;
                        if (!data?.success) throw new Error(data?.message || 'Failed to switch');
                        toast({ title: '✅ Delivery method updated', description: data.message });
                        // Refresh order data
                        const { data: refreshed } = await supabase
                          .from('orders')
                          .select('*')
                          .eq('id', activeOrder.id)
                          .single();
                        if (refreshed) setLiveOrder(refreshed as unknown as Order);
                        onUpdated();
                      } catch (e: any) {
                        toast({ title: 'Error', description: e.message, variant: 'destructive' });
                      } finally {
                        setChangingDeliveryType(false);
                      }
                    }}
                    disabled={changingDeliveryType}
                  >
                    <SelectTrigger className="w-36 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="self_pickup">Carryout</SelectItem>
                    </SelectContent>
                  </Select>
                  {changingDeliveryType && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Switching refunds or charges the delivery fee from the customer's wallet automatically
              </p>
            </CardContent>
          </Card>
        )}


        {orderItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                <Package className="w-3.5 h-3.5" /> Order Items ({orderItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-1.5">
              {orderItems.map((item, i) => {
                const freeQty = item.is_free_meal_item ? (item.free_qty ?? item.quantity) : 0;
                const extraQty = item.is_free_meal_item ? Math.max(0, item.quantity - freeQty) : 0;
                const unitPrice = Number(item.original_unit_price || item.unit_price || 0);
                const platformCost = unitPrice * freeQty;
                const customerCost = unitPrice * extraQty;

                return (
                <div key={i} className="flex items-start justify-between text-sm border-b last:border-0 pb-1.5 last:pb-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium">
                        {item.is_free_meal_item && extraQty > 0 
                          ? `${freeQty}× ${item.product_name}`
                          : `${item.quantity}× ${item.product_name}`
                        }
                      </p>
                      {item.is_free_meal_item && (
                        <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-[9px] gap-0.5">
                          <Gift className="w-2 h-2" /> FREE
                        </Badge>
                      )}
                    </div>
                    {item.is_free_meal_item && extraQty > 0 && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        + {extraQty}× extra added by customer (₦{customerCost.toLocaleString()})
                      </p>
                    )}
                    {item.order_item_addons && item.order_item_addons.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {item.order_item_addons.map((a, j) => (
                          <span key={j} className="block">+ {a.addon_item_name} {a.additional_price > 0 ? `(₦${a.additional_price.toLocaleString()})` : ''}</span>
                        ))}
                      </div>
                    )}
                    {item.special_instructions && (
                      <p className="text-xs text-muted-foreground italic mt-0.5">Note: {item.special_instructions}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {item.is_free_meal_item ? (
                      <div>
                        <p className="font-medium text-green-600">₦{platformCost.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground">Platform pays</p>
                        {customerCost > 0 && (
                          <p className="text-[10px] text-amber-600">+₦{customerCost.toLocaleString()} customer</p>
                        )}
                      </div>
                    ) : item.total_price ? (
                      <p className="font-medium">₦{Number(item.total_price).toLocaleString()}</p>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ── Photo Evidence ── */}
        <OrderPhotoEvidence orderId={activeOrder.id} showDisputeImages />

        {/* ── Admin Complete Self-Pickup Order ── */}
        {activeOrder.delivery_type === 'self_pickup' && activeOrder.status !== 'delivered' && activeOrder.status !== 'cancelled' && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Carryout Order</p>
                <p className="text-xs text-muted-foreground">Manually complete if customer has collected</p>
              </div>
              <Button size="sm" onClick={handleCompleteOrder} disabled={completing} className="gap-1">
                {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Complete Order
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Rider Info (if assigned) ── */}
        {rider && (
          <>
            <Separator />
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                  <Bike className="w-3.5 h-3.5" /> Assigned Rider
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{rider.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      {rider.rating.toFixed(1)} • {rider.totalDeliveries} trips
                    </div>
                  </div>
                  {rider.phone && (
                    <a href={`tel:${rider.phone}`}>
                      <Button size="sm" variant="outline" className="gap-1">
                        <Phone className="w-3.5 h-3.5" /> Call Rider
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Manual Rider Assignment (admin rescue) ── */}
        {needsRider && (
          <>
            <Separator />
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="w-4 h-4" /> Find & Assign Rider
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex gap-2">
                  <Button size="sm" onClick={searchNearbyRiders} disabled={loadingRiders} className="gap-1">
                    {loadingRiders ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                    Search Nearby Riders
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleDispatchPublic} disabled={dispatching} className="gap-1">
                    {dispatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                    Dispatch Publicly
                  </Button>
                </div>

                {nearbyRiders.length > 0 && (
                  <RadioGroup value={selectedRiderId} onValueChange={setSelectedRiderId}>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {nearbyRiders.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer hover:bg-secondary/50"
                          onClick={() => setSelectedRiderId(r.id)}
                        >
                          <RadioGroupItem value={r.id} id={`admin-r-${r.id}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{r.name}</span>
                              {r.currentOrderStatus && (
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {r.currentOrderStatus.replace(/_/g, ' ')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Star className="w-3 h-3" /> {r.rating.toFixed(1)}
                              <span>•</span>
                              {r.totalDeliveries} trips
                              <span>•</span>
                              <MapPin className="w-3 h-3" /> {r.distance.toFixed(1)}km
                              {r.vehicleType && <><span>•</span>{r.vehicleType}</>}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                )}

                {nearbyRiders.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-xs flex items-center gap-1 mb-1">
                          <Gift className="w-3 h-3" /> Rescue Bonus (₦)
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={rescueBonus}
                          onChange={(e) => setRescueBonus(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={handleAssignRider}
                        disabled={assigning || !selectedRiderId}
                        className="gap-1"
                      >
                        {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        Assign Rider
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Bonus is credited from platform commission to rider wallet instantly
                    </p>
                  </div>
                )}

                {!loadingRiders && nearbyRiders.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Click "Search Nearby Riders" to find available riders within 5km of the outlet
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Timestamps ── */}
        <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>Created: {format(new Date(activeOrder.created_at), 'PP p')}</span>
          <span>Updated: {format(new Date(activeOrder.updated_at), 'PP p')}</span>
          <span>Payment: {activeOrder.payment_status}</span>
          <span>Type: {activeOrder.delivery_type?.replace(/_/g, ' ') || 'delivery'}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
