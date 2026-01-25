import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/home/Header';
import { CategoryPills } from '@/components/home/CategoryPills';
import { PromoBanner } from '@/components/home/PromoBanner';
import { CalorieWidget } from '@/components/home/CalorieWidget';
import { VendorGrid } from '@/components/home/VendorGrid';
import { BottomNav } from '@/components/home/BottomNav';
import { Button } from '@/components/ui/button';
import { LogOut, Leaf } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const { user, signOut, loading } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('home');
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-secondary to-background flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-3xl bg-primary flex items-center justify-center shadow-button mb-6">
          <Leaf className="w-11 h-11 text-primary-foreground" />
        </div>
        
        <h1 className="text-3xl font-bold text-foreground mb-2 text-center">
          Fast Calories
        </h1>
        <p className="text-muted-foreground text-center mb-8 max-w-sm">
          Health-aware food delivery with calorie tracking, smart recommendations, and pharmacy services
        </p>

        <div className="w-full max-w-sm space-y-3">
          <Button
            onClick={() => navigate('/auth')}
            className="w-full h-12 text-base font-semibold shadow-button"
          >
            Get Started
          </Button>
          <Button
            onClick={() => navigate('/auth')}
            variant="outline"
            className="w-full h-12 text-base font-semibold"
          >
            Sign In
          </Button>
        </div>

        <div className="mt-12 flex items-center gap-6 text-sm text-muted-foreground">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">500+</p>
            <p>Restaurants</p>
          </div>
          <div className="w-px h-10 bg-border" />
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">50+</p>
            <p>Pharmacies</p>
          </div>
          <div className="w-px h-10 bg-border" />
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">100K+</p>
            <p>Users</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header 
        userName={user.user_metadata?.full_name || 'User'}
        address="Lagos, Nigeria"
      />

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

        {/* Calorie Widget */}
        <CalorieWidget consumed={1250} target={2000} />

        {/* Promo Banner */}
        <PromoBanner />

        {/* Category Pills */}
        <CategoryPills onSelect={setSelectedCategory} />

        {/* Vendors Grid */}
        <VendorGrid category={selectedCategory} />
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
