import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownRight, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;

export default function VendorEarnings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const { data: vendorData } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      setVendor(vendorData);

      if (vendorData) {
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .eq('status', 'delivered')
          .order('created_at', { ascending: false });

        setOrders(ordersData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  // Calculate stats
  const totalEarnings = orders.reduce((sum, o) => sum + Number(o.subtotal), 0);
  const commissionRate = vendor?.commission_rate || 15;
  const totalCommission = totalEarnings * (commissionRate / 100);
  const netEarnings = totalEarnings - totalCommission;

  // This week's earnings
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const thisWeekOrders = orders.filter(
    (o) => new Date(o.created_at) >= oneWeekAgo
  );
  const thisWeekEarnings = thisWeekOrders.reduce(
    (sum, o) => sum + Number(o.subtotal),
    0
  );

  // Today's earnings
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter((o) => o.created_at.startsWith(today));
  const todayEarnings = todayOrders.reduce((sum, o) => sum + Number(o.subtotal), 0);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
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
      <VendorSidebar vendorName={vendor?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Earnings</h1>
              <p className="text-muted-foreground">Track your revenue and payouts</p>
            </div>
            <Button variant="outline" className="gap-2 w-fit">
              <Calendar className="w-4 h-4" />
              This Month
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Today</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(todayEarnings)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {todayOrders.length} orders
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                    <ArrowUpRight className="w-6 h-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">This Week</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(thisWeekEarnings)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thisWeekOrders.length} orders
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Earnings</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(totalEarnings)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {orders.length} orders delivered
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-accent" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Commission ({commissionRate}%)</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(totalCommission)}
                    </p>
                    <p className="text-xs text-success">
                      Net: {formatCurrency(netEarnings)}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                    <ArrowDownRight className="w-6 h-6 text-destructive" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg">Recent Completed Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <div className="text-center py-8">
                  <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No completed orders yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.slice(0, 10).map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
                    >
                      <div>
                        <p className="font-medium text-foreground">{order.order_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('en-NG', {
                            dateStyle: 'medium',
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-success">
                          +{formatCurrency(Number(order.subtotal))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          -{formatCurrency(Number(order.subtotal) * (commissionRate / 100))} fee
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
