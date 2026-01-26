import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Store, Bike, Users, DollarSign, TrendingUp, Loader2 } from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalVendors: 0,
    totalRiders: 0,
    totalUsers: 0,
    totalRevenue: 0,
    pendingVendors: 0,
  });

  useEffect(() => {
    checkAuth();
  }, []);

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
      return;
    }

    await fetchStats();
  };

  const fetchStats = async () => {
    try {
      const [ordersRes, vendorsRes, ridersRes, usersRes, pendingVendorsRes] = await Promise.all([
        supabase.from('orders').select('id, total', { count: 'exact' }),
        supabase.from('vendors').select('id', { count: 'exact' }),
        supabase.from('rider_profiles').select('id', { count: 'exact' }),
        supabase.from('profiles').select('id', { count: 'exact' }),
        supabase.from('vendors').select('id', { count: 'exact' }).eq('is_verified', false),
      ]);

      const totalRevenue = ordersRes.data?.reduce((sum, o) => sum + Number(o.total), 0) || 0;

      setStats({
        totalOrders: ordersRes.count || 0,
        totalVendors: vendorsRes.count || 0,
        totalRiders: ridersRes.count || 0,
        totalUsers: usersRes.count || 0,
        totalRevenue,
        pendingVendors: pendingVendorsRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground">Platform overview and management</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              <Package className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalOrders}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{stats.totalRevenue.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Vendors</CardTitle>
              <Store className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalVendors}</div>
              {stats.pendingVendors > 0 && (
                <p className="text-xs text-calorie-medium">{stats.pendingVendors} pending approval</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Riders</CardTitle>
              <Bike className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalRiders}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
              <Users className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Platform Growth</CardTitle>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-calorie-low">+12%</div>
              <p className="text-xs text-muted-foreground">This month</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => navigate('/admin/vendors')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Store className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Manage Vendors</p>
            </button>
            <button
              onClick={() => navigate('/admin/riders')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Bike className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Manage Riders</p>
            </button>
            <button
              onClick={() => navigate('/admin/orders')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <Package className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">View Orders</p>
            </button>
            <button
              onClick={() => navigate('/admin/promos')}
              className="p-4 rounded-lg border bg-card hover:bg-secondary transition-colors text-center"
            >
              <DollarSign className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Promo Codes</p>
            </button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
