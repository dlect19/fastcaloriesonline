import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { VendorHeader } from '@/components/vendor/VendorHeader';
import { MenuCategoryTabs } from '@/components/vendor/MenuCategoryTabs';
import { VendorReviewsSection } from '@/components/vendor/VendorReviewsSection';
import { ProductCard } from '@/components/vendor/ProductCard';
import { ComboCard } from '@/components/vendor/ComboCard';
import { CartButton } from '@/components/cart/CartButton';
import { BottomNav } from '@/components/home/BottomNav';
import { VendorAccessDenied } from '@/components/vendor/VendorAccessDenied';
import { ArrowLeft, Leaf, Search, Package, Heart } from 'lucide-react';
import { PackageSelector } from '@/components/cart/PackageSelector';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useGeolocation } from '@/hooks/useGeolocation';
import { checkVendorAccess, VendorWithDistance } from '@/hooks/useLocationBasedVendors';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Product = Tables<'products'>;
type ProductCategory = Tables<'product_categories'>;

interface ComboItem {
  id: string;
  combo_id: string;
  product_id: string;
  quantity: number;
  product?: Product;
}

interface Combo {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  combo_price: number;
  original_price: number;
  is_available: boolean | null;
  items: ComboItem[];
}

type AccessDeniedReason = 'outside_radius' | 'location_required' | 'vendor_not_found' | 'vendor_location_unavailable';

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  // Location state — prefer delivery address from Home page over raw GPS
  const { latitude: gpsLat, longitude: gpsLon, loading: geoLoading, getCurrentPosition } = useGeolocation();
  
  const deliveryLocation = (() => {
    try {
      const stored = localStorage.getItem('fc_delivery_location');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.lat && parsed?.lon) return parsed as { lat: number; lon: number };
      }
    } catch {}
    return null;
  })();
  
  const latitude = deliveryLocation?.lat ?? gpsLat;
  const longitude = deliveryLocation?.lon ?? gpsLon;

  // Access control state
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState<AccessDeniedReason>('location_required');
  const [accessDistance, setAccessDistance] = useState<number | undefined>();
  const [accessMaxRadius, setAccessMaxRadius] = useState<number | undefined>();

  // Vendor data state
  const [vendor, setVendor] = useState<VendorWithDistance | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);
  const [outletOverrides, setOutletOverrides] = useState<Record<string, boolean>>({});

  // Check vendor access when location is available
  useEffect(() => {
    if (!id) return;
    
    // Wait for geolocation to finish loading
    if (geoLoading) return;

    // If no location, show location required screen
    if (latitude === null || longitude === null) {
      setAccessDenied(true);
      setAccessDeniedReason('location_required');
      setAccessChecked(true);
      setLoading(false);
      return;
    }

    // Check access with backend
    checkAccess();
  }, [id, latitude, longitude, geoLoading]);

  const checkAccess = async () => {
    if (!id || latitude === null || longitude === null) return;

    setLoading(true);
    const outletId = searchParams.get('outlet') || undefined;
    const result = await checkVendorAccess(id, latitude, longitude, outletId);

    if (!result.success) {
      setAccessDenied(true);
      
      // Map error codes to reasons
      switch (result.error) {
        case 'vendor_outside_radius':
          setAccessDeniedReason('outside_radius');
          setAccessDistance(result.distance);
          setAccessMaxRadius(result.max_radius);
          break;
        case 'vendor_not_found':
          setAccessDeniedReason('vendor_not_found');
          break;
        case 'vendor_location_unavailable':
          setAccessDeniedReason('vendor_location_unavailable');
          break;
        default:
          setAccessDeniedReason('location_required');
      }
      
      setAccessChecked(true);
      setLoading(false);
      return;
    }

    // Access granted - set vendor and fetch remaining data
    setVendor(result.vendor);
    setAccessDenied(false);
    setAccessChecked(true);
    
    // Fetch products, categories, combos
    await fetchVendorProducts();
  };

  const fetchVendorProducts = async () => {
    if (!id) return;
    const outletId = searchParams.get('outlet') || undefined;

    try {
      // Fetch categories
      const { data: categoryData, error: categoryError } = await supabase
        .from('product_categories')
        .select('*')
        .eq('vendor_id', id)
        .order('sort_order');

      if (categoryError) throw categoryError;
      setCategories(categoryData || []);

      // Fetch products (exclude addon meals and hidden meals from customer listing)
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', id)
        .neq('meal_type', 'addon')
        .eq('is_hidden', false)
        .order('name');

      if (productError) throw productError;

      // Fetch per-outlet availability overrides
      let overrides: Record<string, boolean> = {};
      if (outletId) {
        const { data: overrideData } = await supabase
          .from('outlet_product_overrides')
          .select('product_id, is_available')
          .eq('outlet_id', outletId);

        (overrideData || []).forEach(row => {
          overrides[row.product_id] = row.is_available;
        });
        setOutletOverrides(overrides);
      }

      // Apply outlet overrides to products
      const effectiveProducts = (productData || []).map(p => {
        if (outletId && p.id in overrides) {
          return { ...p, is_available: overrides[p.id] };
        }
        return p;
      });

      setProducts(effectiveProducts);

      // Fetch combos
      const { data: combosData, error: combosError } = await supabase
        .from('combos')
        .select('*')
        .eq('vendor_id', id)
        .order('is_available', { ascending: false })
        .order('created_at', { ascending: false });

      if (combosError) throw combosError;

      // Fetch combo items with products
      const combosWithItems = await Promise.all(
        (combosData || []).map(async (combo) => {
          const { data: itemsData } = await supabase
            .from('combo_items')
            .select('*')
            .eq('combo_id', combo.id);

          const itemsWithProducts = (itemsData || []).map((item) => ({
            ...item,
            product: effectiveProducts.find((p) => p.id === item.product_id),
          }));

          return { ...combo, items: itemsWithProducts };
        })
      );

      setCombos(combosWithItems);
    } catch (error) {
      console.error('Error fetching vendor products:', error);
    } finally {
      setLoading(false);
    }
  };

  // Check favorite status
  useEffect(() => {
    if (user && id && !accessDenied) {
      checkFavoriteStatus();
      // Handle ?action=favorite from QR code
      const action = searchParams.get('action');
      if (action === 'favorite') {
        handleToggleFavorite(true);
        navigate(`/vendor/${id}`, { replace: true });
      }
    }
  }, [user, id, accessDenied, searchParams]);

  // Request location on mount
  useEffect(() => {
    getCurrentPosition();
  }, []);

  // Realtime listener for product availability changes
  useEffect(() => {
    if (!id || accessDenied) return;
    const outletId = searchParams.get('outlet') || undefined;

    const channel = supabase
      .channel(`vendor-products-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `vendor_id=eq.${id}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as any;
            // Apply outlet override if exists
            const effectiveAvailability = outletId && updated.id in outletOverrides
              ? outletOverrides[updated.id]
              : updated.is_available;
            setProducts(prev =>
              prev.map(p => p.id === updated.id ? { ...p, ...updated, is_available: effectiveAvailability } : p)
            );
          } else if (payload.eventType === 'INSERT') {
            const newProduct = payload.new as any;
            if (newProduct.meal_type !== 'addon') {
              if (outletId && newProduct.id in outletOverrides) {
                newProduct.is_available = outletOverrides[newProduct.id];
              }
              setProducts(prev => [...prev, newProduct]);
            }
          } else if (payload.eventType === 'DELETE') {
            setProducts(prev => prev.filter(p => p.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    // Also listen for outlet override changes
    const overrideChannel = outletId ? supabase
      .channel(`outlet-overrides-${outletId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'outlet_product_overrides',
          filter: `outlet_id=eq.${outletId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as any;
            setOutletOverrides(prev => ({ ...prev, [row.product_id]: row.is_available }));
            setProducts(prev =>
              prev.map(p => p.id === row.product_id ? { ...p, is_available: row.is_available } : p)
            );
          }
        }
      )
      .subscribe() : null;

    return () => {
      supabase.removeChannel(channel);
      if (overrideChannel) supabase.removeChannel(overrideChannel);
    };
  }, [id, accessDenied, outletOverrides]);

  const checkFavoriteStatus = async () => {
    if (!user || !id) return;
    const { data } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('vendor_id', id)
      .maybeSingle();
    setIsFavorite(!!data);
  };

  const handleToggleFavorite = async (forceAdd = false) => {
    if (!user) {
      toast({ title: 'Please log in', description: 'You need to be logged in to favorite vendors', variant: 'destructive' });
      return;
    }
    if (!id) return;
    setTogglingFavorite(true);
    try {
      if (isFavorite && !forceAdd) {
        await supabase.from('favorites').delete().eq('user_id', user.id).eq('vendor_id', id);
        setIsFavorite(false);
        toast({ title: 'Removed from favorites' });
      } else {
        await supabase.from('favorites').upsert({ user_id: user.id, vendor_id: id }, { onConflict: 'user_id,vendor_id' });
        setIsFavorite(true);
        toast({ title: '❤️ Added to favorites!', description: 'Find this vendor quickly in your Favorites page.' });
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setTogglingFavorite(false);
    }
  };

  const handleRequestLocation = () => {
    getCurrentPosition();
    // Reset states to re-trigger access check
    setAccessChecked(false);
    setAccessDenied(false);
    setLoading(true);
  };

  const filteredProducts = products.filter(product => {
    const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory;
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Loading state
  if (loading || geoLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">
            {geoLoading ? 'Getting your location...' : 'Loading menu...'}
          </p>
        </div>
      </div>
    );
  }

  // Access denied state
  if (accessDenied) {
    return (
      <VendorAccessDenied
        reason={accessDeniedReason}
        distance={accessDistance}
        maxRadius={accessMaxRadius}
        onRequestLocation={handleRequestLocation}
        locationLoading={geoLoading}
      />
    );
  }

  // Vendor not found after access check
  if (!vendor) {
    return (
      <VendorAccessDenied reason="vendor_not_found" />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Back Button & Favorite Button */}
      <div className="fixed top-4 left-4 z-30 flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate(-1)}
          className="rounded-full shadow-lg bg-background/90 backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>
      
      <div className="fixed top-4 right-4 z-30">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => handleToggleFavorite()}
          disabled={togglingFavorite}
          className="rounded-full shadow-lg bg-background/90 backdrop-blur-sm"
        >
          <Heart className={`w-5 h-5 ${isFavorite ? 'fill-destructive text-destructive' : ''}`} />
        </Button>
      </div>

      {/* Vendor Header */}
      <VendorHeader vendor={vendor} />

      {/* Package Selector */}
      <div className="container py-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <PackageSelector vendorId={id!} outletId={searchParams.get('outlet') || undefined} />
        </div>
      </div>

      {/* Search — hidden in combos-only mode */}
      {!(vendor as any).combos_only && (
      <div className="container py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search menu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      )}

      {/* Category Tabs — hidden in combos-only mode */}
      {!(vendor as any).combos_only && categories.length > 0 && (
        <MenuCategoryTabs
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {/* Closed Store Banner */}
      {!vendor.is_open && (
        <div className="container py-3">
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
            <p className="text-sm font-semibold text-destructive">This store is currently closed</p>
            <p className="text-xs text-muted-foreground mt-1">You can browse the menu but ordering is not available right now.</p>
          </div>
        </div>
      )}

      {/* Menu content wrapper — overlay when closed */}
      <div className={`relative ${!vendor.is_open ? 'pointer-events-none' : ''}`}>
        {!vendor.is_open && (
          <div className="absolute inset-0 bg-background/60 z-10 rounded-xl" />
        )}

        {/* Combos Section */}
        {combos.length > 0 && !searchQuery && (
          <section className="container py-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                {vendor.category === 'pharmacy' ? 'Health Packs' : vendor.category === 'market' ? 'Bundle Deals' : 'Combo Deals'}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {combos.map((combo) => (
                <ComboCard key={combo.id} combo={combo} vendor={vendor} outletId={searchParams.get('outlet') || undefined} />
              ))}
            </div>
          </section>
        )}

        {/* Products Grid — hidden when vendor is combos_only */}
        {!(vendor as any).combos_only && (
        <main className="container py-4">
          {filteredProducts.length === 0 && combos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {searchQuery ? 'No items match your search' : 'No items available'}
              </p>
            </div>
          ) : filteredProducts.length === 0 && searchQuery ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No items match your search</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  vendor={vendor}
                  outletId={searchParams.get('outlet') || undefined}
                />
              ))}
            </div>
          )}
        </main>
        )}

        {/* Show empty state if combos_only and no combos */}
        {(vendor as any).combos_only && combos.length === 0 && (
          <div className="container py-12 text-center">
            <p className="text-muted-foreground">No combo deals available yet</p>
          </div>
        )}
      </div>

      {/* Customer Reviews Section */}
      <div className="container py-2 pb-6">
        <VendorReviewsSection vendorId={id!} />
      </div>

      <CartButton />
      <BottomNav />
    </div>
  );
}
