import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useProfileCompletion } from '@/hooks/useProfileCompletion';
import { getPortalRedirect } from '@/hooks/usePortalMemory';
import { Header } from '@/components/home/Header';
import { CategoryPills } from '@/components/home/CategoryPills';
import { CuisineCategoryRow } from '@/components/home/CuisineCategoryRow';
import { EventsCarousel } from '@/components/events/EventsCarousel';
import { PromoBanner } from '@/components/home/PromoBanner';
import { AnnouncementAd } from '@/components/home/AnnouncementAd';
import { CalorieWidget } from '@/components/home/CalorieWidget';
import { VendorGrid } from '@/components/home/VendorGrid';
import { MenuCarousel } from '@/components/home/MenuCarousel';
import { CombosCarousel } from '@/components/home/CombosCarousel';
import { DiscountsCarousel } from '@/components/home/DiscountsCarousel';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { ActionHints } from '@/components/home/ActionHints';
import { PWAInstallBanner } from '@/components/home/PWAInstallBanner';
import { ApkUpdateBanner } from '@/components/shared/ApkUpdateBanner';
import { AppDownloadBanner } from '@/components/shared/AppDownloadBanner';
import { AIMealRecommendation } from '@/components/home/AIMealRecommendation';
import { SpinWheelWidget } from '@/components/home/SpinWheelWidget';
import { ScanFoodBanner } from '@/components/home/ScanFoodBanner';
import { DrugTrackerButton } from '@/components/home/DrugTrackerButton';
import { FreeMealBanner } from '@/components/home/FreeMealBanner';
import { LocationSearch } from '@/components/home/LocationSearch';
import { GuestBanner } from '@/components/home/GuestBanner';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { LogOut, Flame, Star, ChevronRight, Sparkles, Heart, ShieldCheck, Building2, MapPinOff } from 'lucide-react';
import { usePlatformStats, formatCount } from '@/hooks/usePlatformStats';
import { useNavigate } from 'react-router-dom';
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner';
import { useCapacitorPush } from '@/hooks/useCapacitorPush';
import { useGeolocation } from '@/hooks/useGeolocation';
import { supabase } from '@/integrations/supabase/client';
import { invokeGetNearbyVendors } from '@/lib/getNearbyVendors';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import fastCaloriesFullLogo from '@/assets/fast-calories-full-logo.png';

interface DeliveryLocation {
  lat: number | null;
  lon: number | null;
  label: string;
  state?: string | null;
}

export default function Home() {
  const { user, signOut, loading } = useAuth();
  const { isGuest, enableGuestMode, exitGuestMode } = useGuestMode();
  const { isComplete: profileComplete, loading: profileLoading } = useProfileCompletion(user?.id);
  const { settings: platformSettings } = usePlatformSettings();
  const { stats } = usePlatformStats();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('home');
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation | null>(() => {
    try {
      const stored = localStorage.getItem('fc_delivery_location');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [nearbyVendorIds, setNearbyVendorIds] = useState<string[]>([]);
  const [nearbyOutletIds, setNearbyOutletIds] = useState<string[]>([]);
  const navigate = useNavigate();

  // Auto-fetch GPS location on app load for logged-in users — use fresh position (no cache)
  const { latitude: autoLat, longitude: autoLon, accuracy: gpsAccuracy, getCurrentPosition: autoGetPosition } = useGeolocation({ maximumAge: 0 });

  // Register Capacitor native push notifications on mobile
  useCapacitorPush();

  // On PWA launch, redirect to last-used portal if not customer
  // Skip on native Capacitor apps — they have fixed identity (e.g. customer app = always customer)
  // If ?portal=customer is present, clear portal memory and stay on customer app
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('portal') === 'customer') {
      localStorage.removeItem('fc_last_portal');
      // Clean the URL
      navigate('/', { replace: true });
      return;
    }

    import('@capacitor/core').then(({ Capacitor }) => {
      if (Capacitor.isNativePlatform()) return;
      const redirect = getPortalRedirect();
      if (redirect) {
        navigate(redirect, { replace: true });
      }
    }).catch(() => {
      const redirect = getPortalRedirect();
      if (redirect) {
        navigate(redirect, { replace: true });
      }
    });
  }, []);

  // Redirect to profile setup if incomplete
  useEffect(() => {
    if (user && !profileLoading && !profileComplete) {
      navigate('/profile-setup', { state: { returnTo: '/' } });
    }
  }, [user, profileLoading, profileComplete, navigate]);

  // Always fetch GPS for distance display; also used to auto-set delivery location
  useEffect(() => {
    if (user) {
      autoGetPosition();
    }
  }, [user]);

  useEffect(() => {
    if (!autoLat || !autoLon) return;
    
    // Skip if GPS accuracy is too poor (>500m)
    if (gpsAccuracy && gpsAccuracy > 500) {
      console.warn(`GPS accuracy too low (${Math.round(gpsAccuracy)}m), skipping auto-location`);
      return;
    }

    // If no location set, OR current location was auto-detected (GPS), update it
    const isAutoDetected = !deliveryLocation || deliveryLocation.label === 'My GPS Location' || deliveryLocation.label === 'Detecting...';
    // Also update if the GPS coords have shifted significantly (>100m)
    const hasMovedSignificantly = deliveryLocation?.lat && deliveryLocation?.lon
      ? Math.abs(deliveryLocation.lat - autoLat) > 0.001 || Math.abs(deliveryLocation.lon - autoLon) > 0.001
      : true;

    if (!isAutoDetected && !hasMovedSignificantly) return;
    // Don't overwrite manually-selected addresses
    if (deliveryLocation && !isAutoDetected) return;

    const loc = { lat: autoLat, lon: autoLon, label: 'Detecting...', state: null };
    setDeliveryLocation(loc);
    localStorage.setItem('fc_delivery_location', JSON.stringify(loc));
    
    // Reverse-geocode to get real address
    supabase.functions.invoke('google-reverse-geocode', {
      body: { latitude: autoLat, longitude: autoLon },
    }).then(({ data }) => {
      setDeliveryLocation(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          state: data?.state || prev.state,
          label: data?.address_label || 'My GPS Location',
        };
        localStorage.setItem('fc_delivery_location', JSON.stringify(updated));
        return updated;
      });
    }).catch(() => {
      // If geocode fails, at least show a fallback label
      setDeliveryLocation(prev => {
        if (!prev || prev.label !== 'Detecting...') return prev;
        const updated = { ...prev, label: 'My GPS Location' };
        localStorage.setItem('fc_delivery_location', JSON.stringify(updated));
        return updated;
      });
    });
  }, [autoLat, autoLon, gpsAccuracy]);

  // Fetch nearby vendor IDs for MenuCarousel filtering
  useEffect(() => {
    if (!deliveryLocation?.lat || !deliveryLocation?.lon) {
      setNearbyVendorIds([]);
      setNearbyOutletIds([]);
      return;
    }

    let isCancelled = false;

    invokeGetNearbyVendors({
      customer_lat: deliveryLocation.lat,
      customer_lon: deliveryLocation.lon,
      customer_state: deliveryLocation.state || null,
    })
      .then(({ data, error }) => {
        if (isCancelled || error || !data?.vendors) {
          setNearbyVendorIds([]);
          setNearbyOutletIds([]);
          return;
        }
        const ids = [...new Set(data.vendors.map((v: any) => v.id))];
        const outletIds = [...new Set(data.vendors.map((v: any) => v.outlet_id).filter(Boolean))];
        setNearbyVendorIds(ids as string[]);
        setNearbyOutletIds(outletIds as string[]);
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [deliveryLocation?.lat, deliveryLocation?.lon, deliveryLocation?.state]);
  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleLocationSelect = (lat: number, lon: number, label: string, state?: string | null) => {
    const loc = { lat, lon, label, state };
    setDeliveryLocation(loc);
    localStorage.setItem('fc_delivery_location', JSON.stringify(loc));
  };

  const handleClearLocation = () => {
    setDeliveryLocation(null);
    localStorage.removeItem('fc_delivery_location');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="h-16 w-auto animate-pulse-soft" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Guest browsing: discovery-only view of the app, no account required
  if (!user && isGuest) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <Header
          userName="Guest"
          address={deliveryLocation?.label || 'Set your location'}
          onLocationClick={() => setLocationDialogOpen(true)}
        />

        <main className="container py-6 space-y-6">
          <GuestBanner />

          <MenuCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />
          <CombosCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />
          <DiscountsCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />

          <LocationSearch
            onLocationSelect={handleLocationSelect}
            currentLocation={deliveryLocation}
            onClearLocation={handleClearLocation}
            externalOpen={locationDialogOpen}
            onExternalOpenChange={setLocationDialogOpen}
          />

          <EventsCarousel />
          <CuisineCategoryRow />
          <CategoryPills onSelect={setSelectedCategory} />

          <VendorGrid
            category={selectedCategory}
            externalLat={deliveryLocation?.lat}
            externalLon={deliveryLocation?.lon}
            addressState={deliveryLocation?.state}
            gpsLat={autoLat}
            gpsLon={autoLon}
          />

          <div className="rounded-2xl gradient-primary p-5 text-center space-y-2">
            <p className="font-semibold text-primary-foreground">Ready to place your first order?</p>
            <p className="text-primary-foreground/80 text-sm">Sign up free in under a minute.</p>
            <Button
              variant="secondary"
              className="font-semibold"
              onClick={() => { exitGuestMode(); navigate('/auth'); }}
            >
              Create free account
            </Button>
          </div>
        </main>

        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background overflow-hidden">
        {/* Hero Section */}
        <div className="relative min-h-screen flex flex-col">
          {/* Background decorations */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute top-1/3 -left-20 w-60 h-60 bg-accent/10 rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-10 w-40 h-40 bg-primary/5 rounded-full blur-2xl" />
          </div>

          {/* Header */}
          <header className="relative z-10 flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <img src={fastCaloriesFullLogo} alt="Fast Calories" className="h-12 w-auto" />
            </div>
            <Button
              onClick={() => navigate('/auth')}
              variant="ghost"
              className="font-semibold"
            >
              Sign In
            </Button>
          </header>

          {/* Main Content */}
          <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-12 text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary border border-border mb-6 animate-fade-in">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Africa's first AI-powered Food, Health & Lifestyle Super App</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-4 leading-tight animate-fade-in">
              Eat Smart.<br />
              <span className="text-gradient">Track Calories.</span><br />
              Stay Healthy.
            </h1>

            <p className="text-lg text-muted-foreground max-w-md mb-8 animate-fade-in">
              Order food with nutrition insights, get AI meal recommendations, and manage your health goals—all in one app.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mb-12 animate-fade-in">
              <Button
                onClick={() => navigate('/auth')}
                className="flex-1 h-14 text-base font-semibold shadow-button group"
              >
                Get Started Free
                <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button
                onClick={enableGuestMode}
                variant="outline"
                className="flex-1 h-14 text-base font-semibold"
              >
                Browse as Guest
              </Button>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">{formatCount(stats?.vendors.active)}</p>
                <p className="text-sm text-muted-foreground">Vendors</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">{formatCount(stats?.users.total)}</p>
                <p className="text-sm text-muted-foreground">Happy Users</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">{formatCount(stats?.orders.delivered)}</p>
                <p className="text-sm text-muted-foreground">Orders Delivered</p>
              </div>
            </div>
          </main>

          {/* Features Section */}
          <section className="relative z-10 px-6 pb-16">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-bold text-foreground text-center mb-8">
                Why Choose Fast Calories?
              </h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Feature 1 */}
                <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Flame className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Calorie Tracking</h3>
                  <p className="text-sm text-muted-foreground">
                    Every meal shows calorie count and nutrition breakdown. Track your daily intake effortlessly.
                  </p>
                </div>

                {/* Feature 2 */}
                <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Heart className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Smart Recommendations</h3>
                  <p className="text-sm text-muted-foreground">
                    AI-powered suggestions based on your health goals. Balance your meals automatically.
                  </p>
                </div>

                {/* Feature 3 */}
                <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                  <div className="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <ShieldCheck className="w-6 h-6 text-info" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Pharmacy & Reminders</h3>
                  <p className="text-sm text-muted-foreground">
                    Order medications with drug reminders. Never miss a dose with smart notifications.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Floating food emojis for decoration */}
          <div className="absolute top-20 right-8 text-4xl animate-bounce opacity-60 hidden sm:block">🥗</div>
          <div className="absolute top-40 left-12 text-3xl animate-bounce opacity-50 hidden sm:block" style={{ animationDelay: '0.5s' }}>🍎</div>
          <div className="absolute bottom-40 right-20 text-3xl animate-bounce opacity-50 hidden sm:block" style={{ animationDelay: '1s' }}>🥑</div>
          <div className="absolute bottom-60 left-8 text-4xl animate-bounce opacity-60 hidden sm:block" style={{ animationDelay: '0.7s' }}>🍗</div>

          {/* Bottom CTA */}
          <div className="relative z-10 gradient-primary py-6 px-6">
            <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="font-semibold text-primary-foreground">Ready to eat smarter?</p>
                <p className="text-primary-foreground/80 text-sm">Join thousands of health-conscious Nigerians</p>
              </div>
              <Button
                onClick={() => navigate('/install')}
                variant="secondary"
                className="font-semibold shadow-lg"
              >
                Download App
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header 
        userName={user.user_metadata?.full_name || 'User'}
        address={deliveryLocation?.label || 'Set your location'}
        onLocationClick={() => setLocationDialogOpen(true)}
      />

      <AppDownloadBanner appType="customer" />
      <ApkUpdateBanner appType="customer" />

      <main className="container py-6 space-y-6">
        {/* Welcome message */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm">Welcome back,</p>
            <h1 className="text-xl font-bold text-foreground">
              {user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'} 👋
            </h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-destructive"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>

        {/* Drug Tracker shortcut — only appears when user has medications to track */}
        <DrugTrackerButton />

        {/* Push Notification Banner */}
        <PushNotificationBanner />

        {/* DVA Suspension Notice */}
        {platformSettings['dva_enabled'] === 'false' && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
            <Building2 className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-700">Virtual Account Temporarily Unavailable</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bank transfer wallet funding is currently suspended. Use card payment to fund your wallet instead.
              </p>
            </div>
          </div>
        )}

        {/* GPS Accuracy Warning */}
        {gpsAccuracy && gpsAccuracy > 200 && deliveryLocation?.label === 'My GPS Location' && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
            <MapPinOff className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">GPS location may be inaccurate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your device GPS accuracy is ~{Math.round(gpsAccuracy)}m. Tap "Deliver to" above to manually set your correct address for accurate delivery.
              </p>
              <button
                onClick={() => setLocationDialogOpen(true)}
                className="mt-2 text-xs font-semibold text-primary underline"
              >
                Set address manually
              </button>
            </div>
          </div>
        )}

        {/* Action Hints - Orders & Next Steps */}
        <ActionHints />

        {/* Calorie + AI Meal side by side */}
        <div className="grid grid-cols-2 gap-3">
          <CalorieWidget className="!p-3" />
          <AIMealRecommendation />
        </div>

        {/* Scan Food CTA Banner */}
        <ScanFoodBanner />

        {/* Spin Wheel Widget */}
        <SpinWheelWidget />

        {/* Free Meal Promo Banner */}
        <FreeMealBanner />

        {/* Promo Banner */}
        <PromoBanner />

        {/* Announcement Ad Popup */}
        <AnnouncementAd
          userLatitude={deliveryLocation?.lat || null}
          userLongitude={deliveryLocation?.lon || null}
        />

        {/* Random Menu Carousel */}
        <MenuCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />

        {/* Combo Deals Carousel */}
        <CombosCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />

        {/* Discounts Carousel */}
        <DiscountsCarousel nearbyVendorIds={nearbyVendorIds} nearbyOutletIds={nearbyOutletIds} />

        {/* Location Search - Order for any address */}
        <LocationSearch
          onLocationSelect={handleLocationSelect}
          currentLocation={deliveryLocation}
          onClearLocation={handleClearLocation}
          externalOpen={locationDialogOpen}
          onExternalOpenChange={setLocationDialogOpen}
        />

        {/* Events */}
        <EventsCarousel />

        {/* Browse by Cuisine */}
        <CuisineCategoryRow />


        {/* Category Pills */}
        <CategoryPills onSelect={setSelectedCategory} />

        {/* Vendors Grid */}
        <VendorGrid 
          category={selectedCategory}
          externalLat={deliveryLocation?.lat}
          externalLon={deliveryLocation?.lon}
          addressState={deliveryLocation?.state}
          gpsLat={autoLat}
          gpsLon={autoLon}
        />
      </main>

      <CartButton />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
