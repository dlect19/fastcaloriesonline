import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Clock, CheckCircle, XCircle, ChevronRight, RefreshCw, Store, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { CustomerCancelOrderDialog } from '@/components/order/CustomerCancelOrderDialog';

type Order = Tables<'orders'>;

const CANCELABLE_STATUSES = ['pending', 'confirmed'];

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-warning/10 text-warning', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-info/10 text-info', icon: CheckCircle },
  preparing: { label: 'Preparing', color: 'bg-primary/10 text-primary', icon: RefreshCw },
  ready_for_pickup: { label: 'Ready', color: 'bg-accent/10 text-accent', icon: Package },
  searching_for_rider: { label: 'Finding Rider', color: 'bg-warning/10 text-warning', icon: RefreshCw },
  assigned: { label: 'Rider Assigned', color: 'bg-info/10 text-info', icon: Truck },
  picked_up: { label: 'Picked Up', color: 'bg-info/10 text-info', icon: Package },
  on_the_way: { label: 'On the Way', color: 'bg-primary/10 text-primary', icon: Package },
  delivered: { label: 'Delivered', color: 'bg-success/10 text-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive', icon: XCircle },
};

export default function Orders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelSettings, setCancelSettings] = useState({ enabled: true, countdownMinutes: 3 });
  const ITEMS_PER_PAGE = 10;

  const totalPages = Math.ceil(orders.length / ITEMS_PER_PAGE);
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return orders.slice(start, start + ITEMS_PER_PAGE);
  }, [orders, currentPage]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (user) {
      fetchOrders();
      fetchCancelSettings();
      subscribeToOrders();
    }
  }, [user, authLoading, navigate]);

  const fetchCancelSettings = async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['customer_cancel_enabled', 'customer_cancel_countdown_minutes']);
      if (data) {
        const map = Object.fromEntries(data.map((s: any) => [s.key, s.value]));
        setCancelSettings({
          enabled: map['customer_cancel_enabled'] !== 'false',
          countdownMinutes: parseInt(map['customer_cancel_countdown_minutes'] || '3') || 3,
        });
      }
    } catch (err) {
      console.error('Error fetching cancel settings:', err);
    }
  };

  const subscribeToOrders = () => {
    if (!user) return;
    
    const channel = supabase
      .channel('user-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const fetchOrders = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    
    try {
      console.log('Fetching orders for user:', user.id);
      
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Orders query error:', error);
        throw error;
      }
      
      console.log('Orders fetched:', data?.length || 0, 'orders');
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="container py-4">
            <h1 className="text-xl font-bold text-foreground">My Orders</h1>
          </div>
        </header>
        <main className="container py-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl p-4 border border-border">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-48 mb-3" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container py-4">
          <h1 className="text-xl font-bold text-foreground">My Orders</h1>
        </div>
      </header>

      <main className="container py-6">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Package className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No orders yet</h2>
            <p className="text-muted-foreground mb-6">
              Start ordering to see your order history here
            </p>
            <Button onClick={() => navigate('/')}>Browse Vendors</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedOrders.map((order) => {
              const status = statusConfig[order.status] || statusConfig.pending;
              const StatusIcon = status.icon;

              return (
                <div
                  key={order.id}
                  className="bg-card rounded-2xl p-4 border border-border hover:shadow-card transition-shadow cursor-pointer"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
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

                  {order.status === 'preparing' && order.estimated_delivery_at && (
                    <p className="text-xs text-primary mb-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Est. ready: {new Date(order.estimated_delivery_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}

                  {/* Delivery type indicator */}
                  {order.delivery_type === 'self_pickup' ? (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Store className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-medium text-primary">Carryout • No delivery fee!</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Delivery</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {order.total_calories ? `${order.total_calories} cal` : 'No calorie info'}
                      </p>
                      <p className="font-bold text-primary">₦{order.total.toLocaleString()}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>

                  {cancelSettings.enabled && CANCELABLE_STATUSES.includes(order.status) && (
                    <div className="mt-3 pt-3 border-t border-border flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelTarget(order);
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1.5" />
                        Cancel Order
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={orders.length}
              itemsPerPage={ITEMS_PER_PAGE}
            />
          </div>
        )}
      </main>

      <CartButton />
      <BottomNav />
    </div>
  );
}
