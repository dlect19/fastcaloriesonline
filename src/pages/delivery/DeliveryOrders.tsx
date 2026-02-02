import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, MapPin, Clock, User, Phone, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { supabase } from '@/integrations/supabase/client';

interface DeliveryOrder {
  id: string;
  order_number: string;
  status: string;
  delivery_fee: number;
  delivery_address_text: string | null;
  created_at: string;
  delivered_at: string | null;
  rider_id: string | null;
  vendor_name?: string;
  rider_name?: string;
}

export default function DeliveryOrders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { company, loading: companyLoading } = useDeliveryCompany();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      fetchOrders();
    }
  }, [user, authLoading, company, navigate]);

  const fetchOrders = async () => {
    if (!company) return;

    try {
      // Get riders belonging to this company
      const { data: companyRiders } = await supabase
        .from('rider_profiles')
        .select('user_id')
        .eq('delivery_company_id', company.id);

      const riderUserIds = companyRiders?.map(r => r.user_id) || [];

      if (riderUserIds.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      // Get orders for these riders
      const { data: orderData } = await supabase
        .from('orders')
        .select('*, vendors(name)')
        .in('rider_id', riderUserIds)
        .order('created_at', { ascending: false });

      if (orderData) {
        // Get rider names
        const ordersWithDetails = await Promise.all(
          orderData.map(async (order) => {
            let riderName = 'Unknown Rider';
            if (order.rider_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('user_id', order.rider_id)
                .maybeSingle();
              riderName = profile?.full_name || 'Unknown Rider';
            }

            return {
              id: order.id,
              order_number: order.order_number,
              status: order.status,
              delivery_fee: Number(order.delivery_fee) || 0,
              delivery_address_text: order.delivery_address_text,
              created_at: order.created_at,
              delivered_at: order.delivered_at,
              rider_id: order.rider_id,
              vendor_name: order.vendors?.name || 'Unknown Vendor',
              rider_name: riderName,
            };
          })
        );

        setOrders(ordersWithDetails);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; className?: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      confirmed: { variant: 'secondary', label: 'Confirmed' },
      preparing: { variant: 'secondary', label: 'Preparing' },
      ready_for_pickup: { variant: 'outline', label: 'Ready for Pickup' },
      picked_up: { variant: 'default', label: 'Picked Up', className: 'bg-blue-500' },
      on_the_way: { variant: 'default', label: 'On The Way', className: 'bg-blue-600' },
      delivered: { variant: 'default', label: 'Delivered', className: 'bg-success' },
      cancelled: { variant: 'destructive', label: 'Cancelled' },
    };
    const config = variants[status] || { variant: 'secondary', label: status };
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };

  const activeOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const completedOrders = orders.filter(o => o.status === 'delivered');
  const cancelledOrders = orders.filter(o => o.status === 'cancelled');

  if (authLoading || companyLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DeliverySidebar companyName={company?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Deliveries</h1>
            <p className="text-muted-foreground">Track orders assigned to your riders</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-2xl font-bold text-warning">{activeOrders.length}</p>
                <p className="text-sm text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-2xl font-bold text-success">{completedOrders.length}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-2xl font-bold text-destructive">{cancelledOrders.length}</p>
                <p className="text-sm text-muted-foreground">Cancelled</p>
              </CardContent>
            </Card>
          </div>

          {/* Orders Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="active">Active ({activeOrders.length})</TabsTrigger>
              <TabsTrigger value="completed">Completed ({completedOrders.length})</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled ({cancelledOrders.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="space-y-4">
              {activeOrders.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Package className="w-16 h-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No active deliveries</p>
                  </CardContent>
                </Card>
              ) : (
                activeOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))
              )}
            </TabsContent>

            <TabsContent value="completed" className="space-y-4">
              {completedOrders.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <CheckCircle2 className="w-16 h-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No completed deliveries</p>
                  </CardContent>
                </Card>
              ) : (
                completedOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))
              )}
            </TabsContent>

            <TabsContent value="cancelled" className="space-y-4">
              {cancelledOrders.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Package className="w-16 h-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No cancelled deliveries</p>
                  </CardContent>
                </Card>
              ) : (
                cancelledOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function OrderCard({ order }: { order: DeliveryOrder }) {
  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; className?: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      confirmed: { variant: 'secondary', label: 'Confirmed' },
      preparing: { variant: 'secondary', label: 'Preparing' },
      ready_for_pickup: { variant: 'outline', label: 'Ready for Pickup' },
      picked_up: { variant: 'default', label: 'Picked Up', className: 'bg-blue-500' },
      on_the_way: { variant: 'default', label: 'On The Way', className: 'bg-blue-600' },
      delivered: { variant: 'default', label: 'Delivered', className: 'bg-success' },
      cancelled: { variant: 'destructive', label: 'Cancelled' },
    };
    const config = variants[status] || { variant: 'secondary', label: status };
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">#{order.order_number}</span>
              {getStatusBadge(order.status)}
            </div>
            <p className="text-sm text-muted-foreground">From: {order.vendor_name}</p>
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{order.delivery_address_text || 'No address'}</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                {order.rider_name}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {new Date(order.created_at).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">{formatCurrency(order.delivery_fee)}</p>
            <p className="text-xs text-muted-foreground">Delivery Fee</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
