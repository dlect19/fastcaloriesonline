import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, XCircle, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { AdminCancelOrderDialog } from '@/components/admin/AdminCancelOrderDialog';
import { AdminOrderTrackingDialog } from '@/components/admin/AdminOrderTrackingDialog';

export default function AdminOrders() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cancelOrder, setCancelOrder] = useState<any | null>(null);
  const [trackOrder, setTrackOrder] = useState<any | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    fetchOrders();

    // Real-time subscription for order updates
    const channel = supabase
      .channel('admin-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [statusFilter]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select('*, vendors(name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as "pending" | "confirmed" | "preparing" | "ready_for_pickup" | "picked_up" | "on_the_way" | "delivered" | "cancelled");
      }

      const { data } = await query;
      
      if (data && data.length > 0) {
        // Fetch customer profiles for these orders
        const userIds = [...new Set(data.map(o => o.user_id).filter(Boolean))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        const enriched = data.map(order => ({
          ...order,
          customer_name: profileMap.get(order.user_id)?.full_name || 'N/A',
          customer_phone: profileMap.get(order.user_id)?.phone || 'N/A',
        }));
        setOrders(enriched);
      } else {
        setOrders([]);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-calorie-medium text-white',
      confirmed: 'bg-blue-500 text-white',
      preparing: 'bg-purple-500 text-white',
      ready_for_pickup: 'bg-indigo-500 text-white',
      picked_up: 'bg-cyan-500 text-white',
      on_the_way: 'bg-teal-500 text-white',
      delivered: 'bg-calorie-low text-white',
      cancelled: 'bg-destructive text-white',
    };
    return <Badge className={colors[status] || 'bg-secondary'}>{status.replace(/_/g, ' ')}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      
      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Orders</h1>
            <p className="text-muted-foreground">View and manage all platform orders</p>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="preparing">Preparing</SelectItem>
              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
              <SelectItem value="on_the_way">On the Way</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Orders ({orders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                   <tr className="border-b">
                     <th className="text-left py-3 px-4 font-medium">Order #</th>
                     <th className="text-left py-3 px-4 font-medium">Customer</th>
                     <th className="text-left py-3 px-4 font-medium">Phone</th>
                     <th className="text-left py-3 px-4 font-medium">Vendor</th>
                     <th className="text-left py-3 px-4 font-medium">Status</th>
                     <th className="text-left py-3 px-4 font-medium">Total</th>
                     <th className="text-left py-3 px-4 font-medium">Date</th>
                     <th className="text-left py-3 px-4 font-medium">Actions</th>
                   </tr>
                 </thead>
                 <tbody>
                   {orders.map((order) => (
                     <tr key={order.id} className="border-b hover:bg-secondary/50">
                       <td className="py-3 px-4 font-medium">{order.order_number}</td>
                       <td className="py-3 px-4">{order.customer_name}</td>
                       <td className="py-3 px-4 text-muted-foreground">{order.customer_phone}</td>
                       <td className="py-3 px-4">{order.vendors?.name}</td>
                       <td className="py-3 px-4">{getStatusBadge(order.status)}</td>
                       <td className="py-3 px-4">₦{Number(order.total).toLocaleString()}</td>
                       <td className="py-3 px-4 text-muted-foreground">
                         {format(new Date(order.created_at), 'PP')}
                       </td>
                       <td className="py-3 px-4">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => setTrackOrder(order)}
                            >
                              <Eye className="w-4 h-4" />
                              Track
                            </Button>
                            {order.status !== 'cancelled' && order.status !== 'delivered' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive gap-1"
                                onClick={() => setCancelOrder(order)}
                              >
                                <XCircle className="w-4 h-4" />
                                Cancel
                              </Button>
                            )}
                          </div>
                       </td>
                     </tr>
                   ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Admin Cancel Order Dialog */}
        {cancelOrder && (
          <AdminCancelOrderDialog
            open={!!cancelOrder}
            onOpenChange={(open) => !open && setCancelOrder(null)}
            orderId={cancelOrder.id}
            orderNumber={cancelOrder.order_number}
            orderTotal={Number(cancelOrder.total)}
            paymentStatus={cancelOrder.payment_status}
            onCancelled={() => {
              setCancelOrder(null);
              fetchOrders();
            }}
          />
        )}

        {/* Admin Order Tracking Dialog */}
        <AdminOrderTrackingDialog
          open={!!trackOrder}
          onOpenChange={(open) => !open && setTrackOrder(null)}
          order={trackOrder}
          onUpdated={fetchOrders}
        />
      </main>
    </div>
  );
}
