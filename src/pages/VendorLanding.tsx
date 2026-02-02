import { Button } from '@/components/ui/button';
import { ChevronRight, Store, TrendingUp, Users, Clock, Shield, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function VendorLanding() {
  const navigate = useNavigate();

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
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <img src={fastCaloriesLogo} alt="Fast Calories" className="h-10 w-auto" />
          </div>
          <Button
            onClick={() => navigate('/vendor/auth')}
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
            <Store className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">For Restaurants, Pharmacies & Markets</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-4 leading-tight animate-fade-in">
            Grow Your<br />
            <span className="text-gradient">Business Online</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-md mb-8 animate-fade-in">
            Join Nigeria's fastest-growing health-conscious food delivery platform. Reach thousands of customers and boost your sales.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mb-12 animate-fade-in">
            <Button
              onClick={() => navigate('/vendor/auth')}
              className="flex-1 h-14 text-base font-semibold shadow-button group"
            >
              Start Selling Today
              <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              onClick={() => navigate('/vendor/auth')}
              variant="outline"
              className="flex-1 h-14 text-base font-semibold"
            >
              Login to Dashboard
            </Button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">500+</p>
              <p className="text-sm text-muted-foreground">Active Vendors</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">50K+</p>
              <p className="text-sm text-muted-foreground">Daily Orders</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">15%</p>
              <p className="text-sm text-muted-foreground">Low Commission</p>
            </div>
          </div>
        </main>

        {/* Features Section */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground text-center mb-8">
              Why Partner With Us?
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Feature 1 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Increase Revenue</h3>
                <p className="text-sm text-muted-foreground">
                  Access thousands of new customers actively looking for healthy meal options in your area.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Users className="w-6 h-6 text-accent" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Easy Management</h3>
                <p className="text-sm text-muted-foreground">
                  Powerful dashboard to manage orders, menu, staff, and track earnings in real-time.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Shield className="w-6 h-6 text-info" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Reliable Delivery</h3>
                <p className="text-sm text-muted-foreground">
                  Our network of verified riders ensures your orders reach customers fast and safely.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Floating decorations */}
        <div className="absolute top-20 right-8 text-4xl animate-bounce opacity-60 hidden sm:block">🍔</div>
        <div className="absolute top-40 left-12 text-3xl animate-bounce opacity-50 hidden sm:block" style={{ animationDelay: '0.5s' }}>💊</div>
        <div className="absolute bottom-40 right-20 text-3xl animate-bounce opacity-50 hidden sm:block" style={{ animationDelay: '1s' }}>🛒</div>
        <div className="absolute bottom-60 left-8 text-4xl animate-bounce opacity-60 hidden sm:block" style={{ animationDelay: '0.7s' }}>📦</div>

        {/* Bottom CTA */}
        <div className="relative z-10 gradient-primary py-6 px-6">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <p className="font-semibold text-primary-foreground">Ready to grow your business?</p>
              <p className="text-primary-foreground/80 text-sm">Join hundreds of successful vendors today</p>
            </div>
            <Button
              onClick={() => navigate('/vendor/auth')}
              variant="secondary"
              className="font-semibold shadow-lg"
            >
              Get Started Free
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
