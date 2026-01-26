import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, DollarSign, Star, TrendingUp, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function RiderDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [stats, setStats] = useState({
    todayDeliveries: 0,
    todayEarnings: 0,
    totalDeliveries: 0,
    rating: 0,
  });
  const [riderProfile, setRiderProfile] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'rider')) {
      navigate('/rider/auth');
      return;
    }

    await fetchRiderData(user.id);
  };

  const fetchRiderData = async (userId: string) => {
    try {
      // Get rider profile
      const { data: profile } = await supabase
        .from('rider_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (profile) {
        setRiderProfile(profile);
        setIsOnline(profile.is_online || false);
        setStats(prev => ({
          ...prev,
          totalDeliveries: profile.total_deliveries || 0,
          rating: profile.rating || 0,
        }));
      }

      // Get today's deliveries
      const today = new Date().toISOString().split('T')[0];
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('id, total')
        .eq('rider_id', userId)
        .eq('status', 'delivered')
        .gte('delivered_at', today);

      if (todayOrders) {
        const todayEarnings = todayOrders.reduce((sum, o) => sum + (Number(o.total) * 0.1), 0); // 10% commission
        setStats(prev => ({
          ...prev,
          todayDeliveries: todayOrders.length,
          todayEarnings,
        }));
      }
    } catch (error) {
      console.error('Error fetching rider data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleOnline = async (online: boolean) => {
    if (!riderProfile) return;

    try {
      await supabase
        .from('rider_profiles')
        .update({ is_online: online })
        .eq('id', riderProfile.id);

      setIsOnline(online);
      toast({
        title: online ? 'You are now online' : 'You are now offline',
        description: online ? 'You can now receive delivery requests' : 'You will not receive new requests',
      });
    } catch (error) {
      console.error('Error toggling online status:', error);
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
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm md:text-base">Welcome back, rider!</p>
      </div>

      {!riderProfile?.is_verified && (
        <Card className="mb-4 md:mb-6 border-calorie-medium">
          <CardContent className="p-3 md:p-4">
            <p className="text-calorie-medium font-medium text-sm md:text-base">
              ⚠️ Your account is pending verification. You can view the dashboard but cannot accept deliveries yet.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Today's Deliveries</CardTitle>
            <Package className="w-4 h-4 text-muted-foreground hidden md:block" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">{stats.todayDeliveries}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Today's Earnings</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground hidden md:block" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">₦{stats.todayEarnings.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Total Deliveries</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground hidden md:block" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">{stats.totalDeliveries}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Rating</CardTitle>
            <Star className="w-4 h-4 text-muted-foreground hidden md:block" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">{stats.rating.toFixed(1)} ⭐</div>
          </CardContent>
        </Card>
      </div>

      {riderProfile?.is_verified && isOnline && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">Available Deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm md:text-base">New delivery requests will appear here.</p>
          </CardContent>
        </Card>
      )}
    </RiderLayout>
  );
}
