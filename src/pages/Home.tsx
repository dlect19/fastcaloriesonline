import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useProfileCompletion } from '@/hooks/useProfileCompletion';
import { getPortalRedirect } from '@/hooks/usePortalMemory';
import { Header } from '@/components/home/Header';
import { CategoryPills } from '@/components/home/CategoryPills';
import { PromoBanner } from '@/components/home/PromoBanner';
import { CalorieWidget } from '@/components/home/CalorieWidget';
import { VendorGrid } from '@/components/home/VendorGrid';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { ActionHints } from '@/components/home/ActionHints';
import { PWAInstallBanner } from '@/components/home/PWAInstallBanner';
import { ApkUpdateBanner } from '@/components/shared/ApkUpdateBanner';
import { AIMealRecommendation } from '@/components/home/AIMealRecommendation';
import { SpinWheelWidget } from '@/components/home/SpinWheelWidget';
import { LocationSearch } from '@/components/home/LocationSearch';
import { Button } from '@/components/ui/button';
import { LogOut, Flame, Star, ChevronRight, Sparkles, Heart, ShieldCheck, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner';
import { useCapacitorPush } from '@/hooks/useCapacitorPush';
import { useGeolocation } from '@/hooks/useGeolocation';
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
  const { isComplete: profileComplete, loading: profileLoading } = useProfileCompletion(user?.id);
  const { settings: platformSettings } = usePlatformSettings();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('home');
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation | null>(null);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const navigate = useNavigate();

  // Auto-fetch GPS location on app load for logged-in users
  const { latitude: autoLat, longitude: autoLon, getCurrentPosition: autoGetPosition } = useGeolocation();

  // Register Capacitor native push notifications on mobile
  useCapacitorPush();

  // On PWA launch, redirect to last-used portal if not customer
  useEffect(() => {
    const redirect = getPortalRedirect();
    if (redirect) {
      navigate(redirect, { replace: true });
    }
  }, []);

  // Redirect to profile setup if incomplete
  useEffect(() => {
    if (user && !profileLoading && !profileComplete) {
      navigate('/profile-setup', { state: { returnTo: '/' } });
    }
  }, [user, profileLoading, profileComplete, navigate]);

  // Auto-set delivery location from GPS on first load (if user hasn't manually set one)
  useEffect(() => {
    if (user && !deliveryLocation) {
      autoGetPosition();
    }
  }, [user]);

  useEffect(() => {
    if (autoLat && autoLon && !deliveryLocation) {
      // GPS auto-detect: no state available, edge function will reverse-geocode
      setDeliveryLocation({ lat: autoLat, lon: autoLon, label: 'My GPS Location', state: null });
    }
  }, [autoLat, autoLon]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleLocationSelect = (lat: number, lon: number, label: string, state?: string | null) => {
    setDeliveryLocation({ lat, lon, label, state });
  };

  const handleClearLocation = () => {
    setDeliveryLocation(null);
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
              <span className="text-sm font-medium text-foreground">Nigeria's #1 Health-Aware Delivery</span>
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
                onClick={() => navigate('/auth')}
                variant="outline"
                className="flex-1 h-14 text-base font-semibold"
              >
                Explore Menu
              </Button>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">500+</p>
                <p className="text-sm text-muted-foreground">Restaurants</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">50K+</p>
                <p className="text-sm text-muted-foreground">Happy Users</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="text-center">
                <p className="text-3xl font-bold text-foreground">4.9</p>
                <div className="flex items-center justify-center gap-1">
                  <Star className="w-3 h-3 fill-warning text-warning" />
                  <span className="text-sm text-muted-foreground">Rating</span>
                </div>
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

      <PWAInstallBanner />
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
        {/* Action Hints - Orders & Next Steps */}
        <ActionHints />

        {/* Calorie Widget */}
        <CalorieWidget />

        {/* Spin Wheel Widget */}
        <SpinWheelWidget />

        {/* AI Meal Recommendations */}
        <AIMealRecommendation />

        {/* Promo Banner */}
        <PromoBanner />

        {/* Location Search - Order for any address */}
        <LocationSearch
          onLocationSelect={handleLocationSelect}
          currentLocation={deliveryLocation}
          onClearLocation={handleClearLocation}
          externalOpen={locationDialogOpen}
          onExternalOpenChange={setLocationDialogOpen}
        />

        {/* Category Pills */}
        <CategoryPills onSelect={setSelectedCategory} />

        {/* Vendors Grid */}
        <VendorGrid 
          category={selectedCategory}
          externalLat={deliveryLocation?.lat}
          externalLon={deliveryLocation?.lon}
          addressState={deliveryLocation?.state}
        />
      </main>

      <CartButton />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
