import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Store, Utensils, Loader2, Star, MapPin, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

interface FavoriteVendor {
  id: string;
  vendor_id: string;
  created_at: string;
  vendor: Vendor;
}

export default function Favorites() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('vendors');
  const [favoriteVendors, setFavoriteVendors] = useState<FavoriteVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchFavorites();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading]);

  const fetchFavorites = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('id, vendor_id, created_at, vendors(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedData = (data || []).map(fav => ({
        id: fav.id,
        vendor_id: fav.vendor_id,
        created_at: fav.created_at || '',
        vendor: fav.vendors as unknown as Vendor
      })).filter(fav => fav.vendor);

      setFavoriteVendors(formattedData);
    } catch (error) {
      console.error('Error fetching favorites:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFavorite = async (favoriteId: string) => {
    setRemovingId(favoriteId);
    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('id', favoriteId);

      if (error) throw error;

      setFavoriteVendors(prev => prev.filter(f => f.id !== favoriteId));
      toast({ title: 'Removed from favorites' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="container py-4">
            <h1 className="text-xl font-bold text-foreground">Favorites</h1>
          </div>
        </header>
        <main className="container py-6">
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
              Vendors ({favoriteVendors.length})
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
                {favoriteVendors.map((fav) => (
                  <div
                    key={fav.id}
                    className="bg-card rounded-xl border border-border overflow-hidden shadow-soft"
                  >
                    <div 
                      className="cursor-pointer"
                      onClick={() => navigate(`/vendor/${fav.vendor.id}`)}
                    >
                      {fav.vendor.banner_url ? (
                        <img
                          src={fav.vendor.banner_url}
                          alt={fav.vendor.name}
                          className="w-full h-32 object-cover"
                        />
                      ) : (
                        <div className="w-full h-32 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                          <Store className="w-12 h-12 text-primary/50" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 
                            className="font-semibold text-foreground truncate cursor-pointer hover:text-primary"
                            onClick={() => navigate(`/vendor/${fav.vendor.id}`)}
                          >
                            {fav.vendor.name}
                          </h3>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            <div className="flex items-center gap-1">
                              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                              <span>{Number(fav.vendor.rating || 0).toFixed(1)}</span>
                            </div>
                            <span>•</span>
                            <span className="capitalize">{fav.vendor.category}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{fav.vendor.city}, {fav.vendor.state}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveFavorite(fav.id)}
                          disabled={removingId === fav.id}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          {removingId === fav.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="products">
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Utensils className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Coming soon</h2>
              <p className="text-muted-foreground mb-6">
                Product favorites will be available in a future update
              </p>
              <Button onClick={() => navigate('/explore')}>Explore Products</Button>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <CartButton />
      <BottomNav />
    </div>
  );
}
