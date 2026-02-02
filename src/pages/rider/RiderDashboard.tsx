import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Package, DollarSign, Star, TrendingUp, Loader2, MapPin, Settings, Navigation, Bell, ArrowRight, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';

// Haversine formula for distance calculation
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export default function RiderDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [floatModeEnabled, setFloatModeEnabled] = useState(false);
  const [stats, setStats] = useState({
    todayDeliveries: 0,
    todayEarnings: 0,
    totalDeliveries: 0,
    rating: 0,
  });
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [availableOrderCount, setAvailableOrderCount] = useState(0);
  const [affiliatedVendorName, setAffiliatedVendorName] = useState<string | null>(null);

  // Use rider restrictions hook
  const { isAffiliated, affiliatedVendorId, isDeliveryCompanyRider, deliveryCompanyId, canViewEarnings } = useRiderRestrictions(riderProfile);

  useEffect(() => {
    checkAuth();
    // Load float mode preference
    const savedFloatMode = localStorage.getItem('rider_float_mode');
    setFloatModeEnabled(savedFloatMode === 'true');
  }, []);

  // Fetch affiliated vendor/company name
  useEffect(() => {
    if (affiliatedVendorId) {
      fetchVendorName(affiliatedVendorId);
    }
    if (deliveryCompanyId) {
      fetchDeliveryCompanyName(deliveryCompanyId);
    }
  }, [affiliatedVendorId, deliveryCompanyId]);

  const [deliveryCompanyName, setDeliveryCompanyName] = useState<string | null>(null);

  const fetchVendorName = async (vendorId: string) => {
    const { data } = await supabase.from('vendors').select('name').eq('id', vendorId).single();
    if (data) setAffiliatedVendorName(data.name);
  };

  const fetchDeliveryCompanyName = async (companyId: string) => {
    const { data } = await supabase.from('delivery_companies').select('name').eq('id', companyId).single();
    if (data) setDeliveryCompanyName(data.name);
  };

  // Subscribe to realtime order updates
  useEffect(() => {
    if (!riderProfile) return;

    const channel = supabase
      .channel('dashboard-available-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchAvailableOrdersCount(riderProfile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderProfile]);

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
        // Check if this is first login / incomplete profile - force to settings
        if (!profile.vehicle_type) {
          navigate('/rider/settings?setup=true');
          return;
        }

        setRiderProfile(profile);
        setIsOnline(profile.is_online || false);
        setStats(prev => ({
          ...prev,
          totalDeliveries: profile.total_deliveries || 0,
          rating: profile.rating || 0,
        }));

        // Fetch available orders count
        await fetchAvailableOrdersCount(profile);
      }

      // Get today's deliveries - only show earnings for platform riders
      const today = new Date().toISOString().split('T')[0];
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('id, total')
        .eq('rider_id', userId)
        .eq('status', 'delivered')
        .gte('delivered_at', today);

      if (todayOrders) {
        const todayEarnings = todayOrders.reduce((sum, o) => sum + (Number(o.total) * 0.1), 0);
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

  const fetchAvailableOrdersCount = async (profile: any) => {
    try {
      // Build query - for affiliated riders, only count their vendor's orders
      let query = supabase
        .from('orders')
        .select('id, vendors(latitude, longitude)')
        .eq('status', 'ready_for_pickup')
        .is('rider_id', null);

      // VENDOR-ONLY RESTRICTION
      if (profile.affiliated_vendor_id) {
        query = query.eq('vendor_id', profile.affiliated_vendor_id);
      }

      const { data: orders, error } = await query;

      if (error) throw error;

      // Filter orders within rider's work radius
      const riderLat = profile.preferred_latitude || profile.current_latitude;
      const riderLng = profile.preferred_longitude || profile.current_longitude;
      const workRadius = profile.work_radius_km || 10;

      if (!riderLat || !riderLng) {
        setAvailableOrderCount(0);
        return;
      }

      const nearbyOrders = (orders || []).filter(order => {
        const vendorLat = (order.vendors as any)?.latitude;
        const vendorLng = (order.vendors as any)?.longitude;
        
        if (!vendorLat || !vendorLng) return false;
        
        const distance = calculateDistance(riderLat, riderLng, vendorLat, vendorLng);
        return distance <= workRadius;
      });

      setAvailableOrderCount(nearbyOrders.length);
    } catch (error) {
      console.error('Error fetching available orders:', error);
    }
  };

  const toggleOnline = async (online: boolean) => {
    if (!riderProfile) return;

    // Check if NIN is submitted and verified before going online
    if (online && (!riderProfile.nin_number || !riderProfile.is_verified)) {
      toast({
        title: 'Cannot go online',
        description: !riderProfile.nin_number 
          ? 'Please complete your NIN verification first.' 
          : 'Your account is pending admin verification.',
        variant: 'destructive',
      });
      return;
    }

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

  const workLocationText = riderProfile?.preferred_city && riderProfile?.preferred_state
    ? `${riderProfile.preferred_city}, ${riderProfile.preferred_state}`
    : 'Not set';

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline} canViewEarnings={canViewEarnings}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm md:text-base">
          {isDeliveryCompanyRider && deliveryCompanyName 
            ? `Rider for ${deliveryCompanyName}` 
            : (isAffiliated && affiliatedVendorName 
              ? `Rider for ${affiliatedVendorName}` 
              : 'Welcome back, rider!')}
        </p>
      </div>

      {/* Affiliated Rider Notice */}
      {(isAffiliated || isDeliveryCompanyRider) && (
        <Card className="mb-4 md:mb-6 border-primary/30 bg-primary/5">
          <CardContent className="p-3 md:p-4">
            <p className="text-primary font-medium text-sm md:text-base flex items-center gap-2">
              <Lock className="w-4 h-4" />
              You're a dedicated rider for {isDeliveryCompanyRider ? deliveryCompanyName : affiliatedVendorName}. 
              {isDeliveryCompanyRider ? ' Your earnings are managed by your company.' : " You'll only see orders from this vendor."}
            </p>
          </CardContent>
        </Card>
      )}

      {!riderProfile?.is_verified && (
        <Card className="mb-4 md:mb-6 border-calorie-medium">
          <CardContent className="p-3 md:p-4">
            <p className="text-calorie-medium font-medium text-sm md:text-base">
              ⚠️ Your account is pending verification. 
              {!riderProfile?.nin_number && ' Please submit your NIN to complete registration.'}
              {riderProfile?.nin_number && !riderProfile?.nin_verified && ' Your NIN is under review.'}
            </p>
          </CardContent>
        </Card>
      )}

      {!riderProfile?.is_email_verified && (
        <Card className="mb-4 md:mb-6 border-calorie-medium">
          <CardContent className="p-3 md:p-4">
            <p className="text-calorie-medium font-medium text-sm md:text-base">
              ⚠️ Please verify your email to receive delivery requests.
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

        {/* Only show earnings for platform riders (not affiliated) */}
        {canViewEarnings ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Today's Earnings</CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground hidden md:block" />
            </CardHeader>
            <CardContent>
              <div className="text-xl md:text-2xl font-bold">₦{stats.todayEarnings.toLocaleString()}</div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Active Orders</CardTitle>
              <Package className="w-4 h-4 text-muted-foreground hidden md:block" />
            </CardHeader>
            <CardContent>
              <div className="text-xl md:text-2xl font-bold">{availableOrderCount}</div>
            </CardContent>
          </Card>
        )}

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

      {/* Work Location Card */}
      <Card className="mb-6 md:mb-8">
        <CardHeader className="flex flex-row items-center justify-between p-4 md:p-6">
          <div>
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Work Location
            </CardTitle>
            <CardDescription>Your preferred delivery area</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/rider/settings')}>
            <Settings className="w-4 h-4 mr-2" />
            Update
          </Button>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Location</p>
              <p className="font-medium">{workLocationText}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Radius</p>
              <p className="font-medium">{riderProfile?.work_radius_km || 10} km</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Orders Alert */}
      {riderProfile?.is_verified && isOnline && availableOrderCount > 0 && (
        <Card className="mb-6 md:mb-8 border-primary bg-primary/5">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Bell className="w-6 h-6 text-primary animate-pulse" />
                </div>
                <div>
                  <p className="font-bold text-lg md:text-xl">
                    {availableOrderCount} Order{availableOrderCount > 1 ? 's' : ''} Available!
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {isAffiliated 
                      ? `Orders from ${affiliatedVendorName}` 
                      : 'Nearby delivery requests waiting for you'}
                  </p>
                </div>
              </div>
              <Button onClick={() => navigate('/rider/available')} className="gap-2">
                View Orders
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {riderProfile?.is_verified && isOnline && availableOrderCount === 0 && (
        <Card className="mb-6 md:mb-8">
          <CardContent className="p-6 md:p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">
              {isAffiliated 
                ? `No orders from ${affiliatedVendorName}` 
                : 'No available orders nearby'}
            </p>
            <p className="text-muted-foreground text-sm mb-4">
              Stay online - new orders will appear when customers place them.
            </p>
            <Button variant="outline" onClick={() => navigate('/rider/available')}>
              Check Available Orders
            </Button>
          </CardContent>
        </Card>
      )}

      {riderProfile?.is_verified && !isOnline && (
        <Card className="mb-6 md:mb-8">
          <CardContent className="p-6 md:p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">You're offline</p>
            <p className="text-muted-foreground text-sm mb-4">
              Go online to see and accept delivery requests.
            </p>
            <Button onClick={() => toggleOnline(true)}>
              Go Online
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Floating Widget */}
      {floatModeEnabled && (
        <RiderFloatingWidget isOnline={isOnline} onToggleOnline={toggleOnline} />
      )}
    </RiderLayout>
  );
}
