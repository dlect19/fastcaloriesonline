import { Button } from '@/components/ui/button';
import { ChevronRight, Bike, Wallet, Clock, MapPin, Shield, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import riderLogo from '@/assets/rider-logo.png';
import riderFrontImg from '@/assets/landing-rider-front.jpeg';
import riderBackImg from '@/assets/landing-rider-back.jpeg';
import riderMotorcycleImg from '@/assets/landing-rider-motorcycle.png';
import { usePlatformStats, formatCount } from '@/hooks/usePlatformStats';

export default function RiderLanding() {
  const navigate = useNavigate();
  const { stats } = usePlatformStats();

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero Section */}
      <div className="relative min-h-screen flex flex-col">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -left-20 w-60 h-60 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-accent/5 rounded-full blur-2xl" />
        </div>

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <img src={riderLogo} alt="Fast Calories Rider" className="h-14 w-auto" />
          </div>
          <Button
            onClick={() => navigate('/rider/auth')}
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
            <Bike className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-foreground">Become a Delivery Hero</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-4 leading-tight animate-fade-in">
            Earn On Your<br />
            <span className="text-gradient">Own Schedule</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-md mb-8 animate-fade-in">
            Join our network of riders and earn competitive pay delivering meals across Nigeria. Be your own boss with flexible hours.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mb-12 animate-fade-in">
            <Button
              onClick={() => navigate('/rider/auth')}
              className="flex-1 h-14 text-base font-semibold shadow-button group"
            >
              Start Earning Today
              <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              onClick={() => navigate('/rider/auth')}
              variant="outline"
              className="flex-1 h-14 text-base font-semibold"
            >
              Rider Login
            </Button>
          </div>

          {/* Hero Images */}
          <div className="flex items-center justify-center gap-4 mb-12 animate-fade-in">
            <img src={riderFrontImg} alt="Fast Calories rider" className="w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl shadow-card" />
            <img src={riderMotorcycleImg} alt="Rider on motorcycle" className="w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl shadow-card -mt-6" />
            <img src={riderBackImg} alt="Fast Calories delivery bag" className="w-32 h-44 sm:w-40 sm:h-56 object-cover rounded-2xl shadow-card" />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8 sm:gap-12 animate-fade-in">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{formatCount(stats?.riders.verified)}</p>
              <p className="text-sm text-muted-foreground">Active Riders</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{formatCount(stats?.orders.delivered)}</p>
              <p className="text-sm text-muted-foreground">Deliveries</p>
            </div>
            <div className="w-px h-12 bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{formatCount(stats?.riders.online_now, '')}</p>
              <p className="text-sm text-muted-foreground">Online Now</p>
            </div>
          </div>
        </main>

        {/* Features Section */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground text-center mb-8">
              Why Ride With Us?
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Feature 1 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Wallet className="w-6 h-6 text-accent" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Competitive Pay</h3>
                <p className="text-sm text-muted-foreground">
                  Earn up to 80% of delivery fees plus tips. Weekly payouts directly to your bank account.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Flexible Hours</h3>
                <p className="text-sm text-muted-foreground">
                  Work when you want, where you want. Go online anytime and start accepting deliveries.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card rounded-2xl p-6 border border-border shadow-soft hover:shadow-card transition-shadow group">
                <div className="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <MapPin className="w-6 h-6 text-info" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Smart Routing</h3>
                <p className="text-sm text-muted-foreground">
                  Get orders near you with optimized routes. Less travel time, more deliveries.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Floating decorations */}
        <div className="absolute top-20 right-4 sm:right-8 text-2xl sm:text-4xl animate-bounce opacity-60">🏍️</div>
        <div className="absolute top-40 left-4 sm:left-12 text-xl sm:text-3xl animate-bounce opacity-50" style={{ animationDelay: '0.5s' }}>📍</div>
        <div className="absolute bottom-40 right-4 sm:right-20 text-xl sm:text-3xl animate-bounce opacity-50" style={{ animationDelay: '1s' }}>💰</div>
        <div className="absolute bottom-60 left-4 sm:left-8 text-2xl sm:text-4xl animate-bounce opacity-60" style={{ animationDelay: '0.7s' }}>🎯</div>

        {/* Bottom CTA */}
        <div className="relative z-10 gradient-primary py-6 px-6">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <p className="font-semibold text-primary-foreground">Ready to hit the road?</p>
              <p className="text-primary-foreground/80 text-sm">Sign up in minutes and start earning today</p>
            </div>
            <Button
              onClick={() => navigate('/rider/auth')}
              variant="secondary"
              className="font-semibold shadow-lg"
            >
              Become a Rider
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
