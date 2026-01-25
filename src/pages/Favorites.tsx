import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Store, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { useAuth } from '@/hooks/useAuth';

export default function Favorites() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('vendors');

  // For now, favorites will be empty - this can be connected to a favorites table later
  const favoriteVendors: any[] = [];
  const favoriteProducts: any[] = [];

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="container py-4">
            <h1 className="text-xl font-bold text-foreground">Favorites</h1>
          </div>
        </header>
        <main className="container py-6">
          <div className="text-center py-16">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="container py-4">
            <h1 className="text-xl font-bold text-foreground">Favorites</h1>
          </div>
        </header>
        <main className="container py-6">
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Heart className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Sign in to view favorites</h2>
            <p className="text-muted-foreground mb-6">
              Save your favorite vendors and products for quick access
            </p>
            <Button onClick={() => navigate('/auth')}>Sign In</Button>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container py-4">
          <h1 className="text-xl font-bold text-foreground">Favorites</h1>
        </div>
      </header>

      <main className="container py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="vendors" className="gap-2">
              <Store className="w-4 h-4" />
              Vendors
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-2">
              <Utensils className="w-4 h-4" />
              Products
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vendors">
            {favoriteVendors.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Store className="w-10 h-10 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">No favorite vendors</h2>
                <p className="text-muted-foreground mb-6">
                  Tap the heart icon on any vendor to save them here
                </p>
                <Button onClick={() => navigate('/explore')}>Explore Vendors</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Favorite vendors will be rendered here */}
              </div>
            )}
          </TabsContent>

          <TabsContent value="products">
            {favoriteProducts.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Utensils className="w-10 h-10 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">No favorite products</h2>
                <p className="text-muted-foreground mb-6">
                  Tap the heart icon on any product to save them here
                </p>
                <Button onClick={() => navigate('/explore')}>Explore Products</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Favorite products will be rendered here */}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <CartButton />
      <BottomNav />
    </div>
  );
}
