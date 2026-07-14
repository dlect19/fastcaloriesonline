import { Button } from '@/components/ui/button';
import { ChevronRight, Building2, TrendingUp, Users, Truck, BarChart3, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import fastCaloriesLogo from '@/assets/fast-calories-text-logo.png';
import riderMotorcycleImg from '@/assets/landing-rider-motorcycle.png';
import riderBackImg from '@/assets/landing-rider-back.jpeg';
import { usePlatformStats, formatCount } from '@/hooks/usePlatformStats';

export default function DeliveryCompanyLanding() {
  const navigate = useNavigate();
  const { stats } = usePlatformStats();

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero Section */}
      <div className="relative min-h-screen flex flex-col">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-info/10 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -left-20 w-60 h-60 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-info/5 rounded-full blur-2xl" />
        </div>

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <img src={fastCaloriesLogo} alt="Fast Calories" className="h-14 w-auto" />
          </div>
          <Button
            onClick={() => navigate('/delivery/auth')}
            variant="ghost"
            className="font-semibold"
          >
            Partner Login
          </Button>
        </header>

        {/* Main Content */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-12 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary border border-border mb-6 animate-fade-in">
            <Building2 className="w-4 h-4 text-info" />
            <span className="text-sm font-medium text-foreground">Logistics Partner Program</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-4 leading-tight animate-fade-in">
            Scale Your<br />
            <span className="text-gradient">Delivery Business</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-md mb-8 animate-fade-in">
            Partner with Nigeria's leading health-focused delivery platform. Leverage your fleet to capture high-volume delivery demand.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mb-12 animate-fade-in">
            <Button
              onClick={() => navigate('/delivery/auth')}
              className="flex-1 h-14 text-base font-semibold shadow-button group"
            >
              Apply as Partner
              <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              onClick={() => navigate('/delivery/auth')}
              variant="outline"
              className="flex-1 h-14 text-base font-semibold"
            >
              Partner Dashboard
            </Button>
          </div>

          {/* Hero Images */}
          <div className="flex items-center justify-center gap-4 mb-12 animate-fade-in">
            <img src={riderMotorcycleImg} alt="Rider on motorcycle with Fast Calories bag" className="w-44 h-32 sm:w-64 sm:h-44 object-cover rounded-2xl shadow-card" />
            <img src={riderBackImg} alt="Fast Calories delivery bag" className="w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl shadow-card -mt-4" />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">50K+</p>
              <p className="text-sm text-muted-foreground">Daily Deliveries</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">20+</p>
              <p className="text-sm text-muted-foreground">Partner Companies</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">10%</p>
              <p className="text-sm text-muted-foreground">Platform Fee</p>
            </div>
          </div>
        </main>

        {/* Features Section */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground text-center mb-8">
              Why Partner With Fast Calories?
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Feature 1 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-6 h-6 text-info" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">High Volume Orders</h3>
                <p className="text-sm text-muted-foreground">
                  Access consistent delivery demand from 500+ vendors and 50K+ active customers.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Fleet Management</h3>
                <p className="text-sm text-muted-foreground">
                  Onboard and manage your riders through our intuitive dashboard. Track performance in real-time.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <BarChart3 className="w-6 h-6 text-accent" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Transparent Earnings</h3>
                <p className="text-sm text-muted-foreground">
                  Clear commission structure with automated weekly payouts. Full visibility into rider earnings.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground text-center mb-8">
              How It Works
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">1</div>
                <h4 className="font-medium text-foreground mb-1">Apply</h4>
                <p className="text-xs text-muted-foreground">Submit your company details</p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">2</div>
                <h4 className="font-medium text-foreground mb-1">Get Verified</h4>
                <p className="text-xs text-muted-foreground">Our team reviews your application</p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">3</div>
                <h4 className="font-medium text-foreground mb-1">Onboard Riders</h4>
                <p className="text-xs text-muted-foreground">Add your fleet to the platform</p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">4</div>
                <h4 className="font-medium text-foreground mb-1">Start Earning</h4>
                <p className="text-xs text-muted-foreground">Receive orders and grow</p>
              </div>
            </div>
          </div>
        </section>

        {/* Floating decorations */}
        <div className="absolute top-20 right-4 sm:right-8 text-2xl sm:text-4xl animate-bounce opacity-60">🚚</div>
        <div className="absolute top-40 left-4 sm:left-12 text-xl sm:text-3xl animate-bounce opacity-50" style={{ animationDelay: '0.5s' }}>📊</div>
        <div className="absolute bottom-40 right-4 sm:right-20 text-xl sm:text-3xl animate-bounce opacity-50" style={{ animationDelay: '1s' }}>🤝</div>
        <div className="absolute bottom-60 left-4 sm:left-8 text-2xl sm:text-4xl animate-bounce opacity-60" style={{ animationDelay: '0.7s' }}>💼</div>

        {/* Bottom CTA */}
        <div className="relative z-10 gradient-primary py-6 px-6">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <p className="font-semibold text-primary-foreground">Ready to scale your logistics?</p>
              <p className="text-primary-foreground/80 text-sm">Apply today and start receiving orders within 48 hours</p>
            </div>
            <Button
              onClick={() => navigate('/delivery/auth')}
              variant="secondary"
              className="font-semibold shadow-lg"
            >
              Become a Partner
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
