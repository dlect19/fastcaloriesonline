import { Button } from '@/components/ui/button';
import { ChevronRight, Store, TrendingUp, Users, Clock, Shield, Sparkles, Monitor, Printer, CreditCard, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import fastCaloriesLogo from '@/assets/fast-calories-text-logo.png';
import vendorRestaurantImg from '@/assets/landing-vendor-restaurant.png';
import customerAppImg from '@/assets/landing-customer-app.png';
import { usePlatformStats, formatCount } from '@/hooks/usePlatformStats';

export default function VendorLanding() {
  const navigate = useNavigate();
  const { stats } = usePlatformStats();

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
            <img src={fastCaloriesLogo} alt="Fast Calories" className="h-14 w-auto" />
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

          {/* Hero Images */}
          <div className="flex items-center justify-center gap-4 mb-12 animate-fade-in">
            <img src={vendorRestaurantImg} alt="Restaurant partnering with Fast Calories" className="w-44 h-32 sm:w-64 sm:h-44 object-cover rounded-2xl shadow-card" />
            <img src={customerAppImg} alt="Customer using Fast Calories app" className="w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl shadow-card -mt-4" />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{formatCount(stats?.vendors.active)}</p>
              <p className="text-sm text-muted-foreground">Active Vendors</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{formatCount(stats?.orders.delivered)}</p>
              <p className="text-sm text-muted-foreground">Orders Delivered</p>
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

        {/* NEW: In-Store POS Section */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-card">
              <div className="absolute inset-0 gradient-primary opacity-5" />
              <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 p-8 sm:p-10">
                {/* Left: copy */}
                <div className="flex flex-col justify-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-4 w-fit">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-primary uppercase tracking-wide">New • In-Store POS</span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-3 leading-tight">
                    Sell in-store with our<br />
                    <span className="text-gradient">built-in POS</span>
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    One system for online <em>and</em> walk-in sales. Run your counter, accept any payment, print receipts on Bluetooth printers, and keep inventory in perfect sync — automatically.
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="flex items-start gap-2">
                      <CreditCard className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">All payments</p>
                        <p className="text-xs text-muted-foreground">Cash, transfer, card, wallet</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Printer className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Bluetooth receipts</p>
                        <p className="text-xs text-muted-foreground">ESC/POS thermal printers</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Package className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Live inventory</p>
                        <p className="text-xs text-muted-foreground">Pack & sachet auto-sync</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Monitor className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Hold & resume</p>
                        <p className="text-xs text-muted-foreground">Park carts, never lose a sale</p>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => navigate('/vendor/auth')}
                    className="w-fit h-12 px-6 font-semibold shadow-button group"
                  >
                    Try the POS Free
                    <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>

                {/* Right: mock POS device */}
                <div className="relative flex items-center justify-center">
                  <div className="relative w-full max-w-sm">
                    {/* Tablet frame */}
                    <div className="relative bg-foreground rounded-3xl p-3 shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
                      <div className="bg-background rounded-2xl overflow-hidden aspect-[3/4]">
                        {/* POS header */}
                        <div className="gradient-primary p-3 text-primary-foreground">
                          <p className="text-xs opacity-80">Point of Sale</p>
                          <p className="text-sm font-bold">My Store · Counter 1</p>
                        </div>
                        {/* Items */}
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between p-2 rounded-lg bg-secondary">
                            <div>
                              <p className="text-xs font-semibold text-foreground">Jollof Rice</p>
                              <p className="text-[10px] text-muted-foreground">x2</p>
                            </div>
                            <p className="text-xs font-bold text-foreground">₦5,000</p>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-secondary">
                            <div>
                              <p className="text-xs font-semibold text-foreground">Paracetamol</p>
                              <p className="text-[10px] text-muted-foreground">3 sachets</p>
                            </div>
                            <p className="text-xs font-bold text-foreground">₦450</p>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-secondary">
                            <div>
                              <p className="text-xs font-semibold text-foreground">Coke 50cl</p>
                              <p className="text-[10px] text-muted-foreground">x1</p>
                            </div>
                            <p className="text-xs font-bold text-foreground">₦500</p>
                          </div>
                          <div className="border-t border-border pt-2 flex items-center justify-between">
                            <p className="text-sm font-bold text-foreground">Total</p>
                            <p className="text-sm font-bold text-primary">₦5,950</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div className="bg-primary text-primary-foreground text-center text-[10px] font-semibold py-2 rounded-lg">Cash</div>
                            <div className="bg-secondary text-foreground text-center text-[10px] font-semibold py-2 rounded-lg border border-border">Transfer</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Floating receipt */}
                    <div className="absolute -bottom-6 -left-6 bg-card border border-border rounded-lg p-3 shadow-card rotate-[-8deg] hidden sm:block">
                      <Printer className="w-4 h-4 text-primary mb-1" />
                      <p className="text-[10px] font-semibold text-foreground">Receipt printed</p>
                      <p className="text-[9px] text-muted-foreground">via Bluetooth</p>
                    </div>
                    {/* Floating badge */}
                    <div className="absolute -top-4 -right-4 bg-primary text-primary-foreground rounded-full px-3 py-1.5 shadow-button text-xs font-bold rotate-12">
                      ✨ NEW
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Floating decorations */}
        <div className="absolute top-32 sm:top-20 right-3 sm:right-8 text-3xl sm:text-4xl animate-bounce opacity-70 pointer-events-none">🍔</div>
        <div className="absolute top-56 sm:top-40 left-3 sm:left-12 text-2xl sm:text-3xl animate-bounce opacity-60 pointer-events-none" style={{ animationDelay: '0.5s' }}>💊</div>
        <div className="absolute bottom-32 sm:bottom-40 right-3 sm:right-20 text-2xl sm:text-3xl animate-bounce opacity-60 pointer-events-none" style={{ animationDelay: '1s' }}>🛒</div>
        <div className="absolute bottom-52 sm:bottom-60 left-3 sm:left-8 text-3xl sm:text-4xl animate-bounce opacity-70 pointer-events-none" style={{ animationDelay: '0.7s' }}>📦</div>

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
