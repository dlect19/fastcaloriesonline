import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useProfileCompletion } from '@/hooks/useProfileCompletion';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { Package, DollarSign, Star, TrendingUp, Loader2, MapPin, Settings, Navigation, Bell, ArrowRight, Lock, Bike } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner';

// Haversine formula for distance calculation
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
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
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [stats, setStats] = useState({
    todayDeliveries: 0,
    todayEarnings: 0,
    inTransitOrders: 0,
    inTransitEarnings: 0,
    totalDeliveries: 0,
    rating: 0,
  });
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [availableOrderCount, setAvailableOrderCount] = useState(0);
  const [affiliatedVendorName, setAffiliatedVendorName] = useState<string | null>(null);
  const [showTestNotification, setShowTestNotification] = useState(false);

  const { isAffiliated, affiliatedVendorId, isDeliveryCompanyRider, deliveryCompanyId, canViewEarnings } = useRiderRestrictions(riderProfile);

  useEffect(() => {
    checkAuth();
    const savedFloatMode = localStorage.getItem('rider_float_mode');
    setFloatModeEnabled(savedFloatMode === 'true');
    fetchTestNotificationSetting();
  }, []);

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

  const fetchTestNotificationSetting = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'show_rider_test_notification')
      .maybeSingle();
    setShowTestNotification(data?.value === 'true');
  };

  const fetchDeliveryCompanyName = async (companyId: string) => {
    const { data } = await supabase.from('delivery_companies').select('name').eq('id', companyId).single();
    if (data) setDeliveryCompanyName(data.name);
  };

  // Refetch stats when date range changes
  useEffect(() => {
    if (userId) {
      fetchFilteredStats(userId);
    }
  }, [dateRange]);

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

  const getDateRangeForQuery = () => {
    if (dateRange.from) {
      const start = dateRange.from.toISOString();
      let end: string;
      if (dateRange.to) {
        const endDate = new Date(dateRange.to);
        endDate.setHours(23, 59, 59, 999);
        end = endDate.toISOString();
      } else {
        const endDate = new Date(dateRange.from);
        endDate.setHours(23, 59, 59, 999);
        end = endDate.toISOString();
      }
      return { start, end };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { start: today.toISOString(), end: tomorrow.toISOString() };
  };

  const fetchFilteredStats = async (uid: string) => {
    try {
      const { start, end } = getDateRangeForQuery();

      // Count delivered orders in the period
      const { data: deliveredOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('rider_id', uid)
        .eq('status', 'delivered')
        .gte('delivered_at', start)
        .lt('delivered_at', end);

      // Count in-transit orders in the period
      const { data: inTransitOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('rider_id', uid)
        .in('status', ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'])
        .gte('created_at', start)
        .lt('created_at', end);

      // Get the rider's wallet
      const { data: riderWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', uid)
        .eq('wallet_type', 'rider')
        .maybeSingle();

      let todayEarnings = 0;
      let inTransitEarnings = 0;

      if (riderWallet) {
        // Fetch actual earnings from wallet_transactions for delivered orders
        const deliveredIds = (deliveredOrders || []).map(o => o.id);
        if (deliveredIds.length > 0) {
          const { data: earningsTx } = await supabase
            .from('wallet_transactions')
            .select('amount')
            .eq('wallet_id', riderWallet.id)
            .eq('category', 'rider_share')
            .eq('transaction_type', 'credit')
            .eq('status', 'completed')
            .in('order_id', deliveredIds);

          todayEarnings = (earningsTx || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
        }

        // Fetch pending earnings for in-transit orders
        const inTransitIds = (inTransitOrders || []).map(o => o.id);
        if (inTransitIds.length > 0) {
          const { data: pendingTx } = await supabase
            .from('wallet_transactions')
            .select('amount')
            .eq('wallet_id', riderWallet.id)
            .eq('category', 'rider_share')
            .eq('transaction_type', 'credit')
            .in('order_id', inTransitIds);

          inTransitEarnings = (pendingTx || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
        }
      }

      setStats(prev => ({
        ...prev,
        todayDeliveries: deliveredOrders?.length || 0,
        todayEarnings,
        inTransitOrders: inTransitOrders?.length || 0,
        inTransitEarnings,
      }));
    } catch (error) {
      console.error('Error fetching filtered stats:', error);
    }
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profileData?.full_name?.trim() || !profileData?.phone?.trim()) {
      navigate('/profile-setup', { state: { returnTo: '/rider/dashboard' } });
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

    setUserId(user.id);
    await fetchRiderData(user.id);
  };

  const fetchRiderData = async (uid: string) => {
    try {
      const { data: profile } = await supabase
        .from('rider_profiles')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (profile) {
        if (!profile.vehicle_type) {
          navigate('/rider/settings?setup=true');
          return;
        }

        setRiderProfile(profile);
        setIsOnline(profile.is_online || false);

        // Count actual delivered orders instead of stale total_deliveries column
        const { count: deliveredCount } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('rider_id', uid)
          .eq('status', 'delivered');

        setStats(prev => ({
          ...prev,
          totalDeliveries: deliveredCount || 0,
          rating: profile.rating || 0,
        }));

        await fetchAvailableOrdersCount(profile);
      }

      // Fetch date-range stats
      await fetchFilteredStats(uid);
    } catch (error) {
      console.error('Error fetching rider data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableOrdersCount = async (profile: any) => {
    try {
      let query = supabase
        .from('orders')
        .select('id, vendors(latitude, longitude)')
        .eq('status', 'ready_for_pickup')
        .is('rider_id', null);

      if (profile.affiliated_vendor_id) {
        query = query.eq('vendor_id', profile.affiliated_vendor_id);
      }

      const { data: orders, error } = await query;
      if (error) throw error;

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

  const getDateLabel = () => {
    if (dateRange.from) return 'Filtered';
    return "Today's";
  };

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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-calorie-medium font-medium text-sm md:text-base">
                ⚠️ Your account is pending verification. 
                {!riderProfile?.nin_number && ' Please submit your NIN to complete registration.'}
                {riderProfile?.nin_number && !riderProfile?.nin_verified && ' Your NIN is under review.'}
              </p>
              {!riderProfile?.nin_number && (
                <Button 
                  size="sm" 
                  onClick={() => navigate('/rider/settings')}
                  className="whitespace-nowrap"
                >
                  Submit NIN
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
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

      {/* Push Notification Banner */}
      <PushNotificationBanner />

      {/* Test Push Notification Button - controlled by admin setting */}
      {riderProfile?.is_verified && showTestNotification && (
        <Card className="mb-4 md:mb-6">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Test Push Notification</p>
                <p className="text-xs text-muted-foreground">Send a test notification to this device</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('send-push-notification', {
                      body: {
                        user_id: userId,
                        title: '🔔 Test Notification',
                        body: 'Push notifications are working!',
                        data: { type: 'test' },
                      },
                    });
                    toast({
                      title: error ? 'Failed' : 'Sent!',
                      description: error ? String(error.message || error) : (data?.message || 'Test notification sent'),
                      variant: error ? 'destructive' : 'default',
                    });
                  } catch (e: any) {
                    toast({ title: 'Error', description: e.message, variant: 'destructive' });
                  }
                }}
              >
                <Bell className="w-4 h-4 mr-1" />
                Test
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Range Filter */}
      <div className="mb-4 md:mb-6">
        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6 mb-6 md:mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{getDateLabel()} Deliveries</CardTitle>
            <Package className="w-4 h-4 text-muted-foreground hidden md:block" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">{stats.todayDeliveries}</div>
          </CardContent>
        </Card>

        {canViewEarnings ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{getDateLabel()} Earnings</CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground hidden md:block" />
            </CardHeader>
            <CardContent>
              <div className="text-xl md:text-2xl font-bold text-success">₦{stats.todayEarnings.toLocaleString()}</div>
              <p className="text-xs text-success mt-1">Completed</p>
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

        {canViewEarnings && (
          <Card className="border-l-4 border-l-warning">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Under Delivery</CardTitle>
              <Bike className="w-4 h-4 text-warning hidden md:block" />
            </CardHeader>
            <CardContent>
              <div className="text-xl md:text-2xl font-bold text-warning">₦{stats.inTransitEarnings.toLocaleString()}</div>
              <p className="text-xs text-warning mt-1">{stats.inTransitOrders} in transit</p>
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
                      : 'Near your work location'}
                  </p>
                </div>
              </div>
              <Button onClick={() => navigate('/rider/available-orders')}>
                View <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <Button
          variant="outline"
          className="h-auto py-4 md:py-6 flex flex-col items-center gap-2"
          onClick={() => navigate('/rider/available-orders')}
        >
          <Package className="w-5 md:w-6 h-5 md:h-6 text-primary" />
          <span className="text-xs md:text-sm">Available Orders</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 md:py-6 flex flex-col items-center gap-2"
          onClick={() => navigate('/rider/orders')}
        >
          <TrendingUp className="w-5 md:w-6 h-5 md:h-6 text-primary" />
          <span className="text-xs md:text-sm">My Orders</span>
        </Button>
        {canViewEarnings && (
          <Button
            variant="outline"
            className="h-auto py-4 md:py-6 flex flex-col items-center gap-2"
            onClick={() => navigate('/rider/earnings')}
          >
            <DollarSign className="w-5 md:w-6 h-5 md:h-6 text-primary" />
            <span className="text-xs md:text-sm">Earnings</span>
          </Button>
        )}
        <Button
          variant="outline"
          className="h-auto py-4 md:py-6 flex flex-col items-center gap-2"
          onClick={() => navigate('/rider/settings')}
        >
          <Settings className="w-5 md:w-6 h-5 md:h-6 text-primary" />
          <span className="text-xs md:text-sm">Settings</span>
        </Button>
      </div>

      {/* Floating Widget */}
      {floatModeEnabled && riderProfile?.is_verified && isOnline && (
        <RiderFloatingWidget
          isOnline={isOnline}
          onToggleOnline={toggleOnline}
        />
      )}
    </RiderLayout>
  );
}
