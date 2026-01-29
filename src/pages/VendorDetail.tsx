import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { VendorHeader } from '@/components/vendor/VendorHeader';
import { MenuCategoryTabs } from '@/components/vendor/MenuCategoryTabs';
import { ProductCard } from '@/components/vendor/ProductCard';
import { ComboCard } from '@/components/vendor/ComboCard';
import { CartButton } from '@/components/cart/CartButton';
import { BottomNav } from '@/components/home/BottomNav';
import { ArrowLeft, Leaf, Search, Package, Heart } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
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

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);

  useEffect(() => {
    if (id) {
      fetchVendorData();
      if (user) {
        checkFavoriteStatus();
        // Handle ?action=favorite from QR code
        const action = searchParams.get('action');
        if (action === 'favorite') {
          handleToggleFavorite(true);
          // Remove the query param after handling
          navigate(`/vendor/${id}`, { replace: true });
        }
      }
    }
  }, [id, user, searchParams]);

  const fetchVendorData = async () => {
    if (!id) return;

    setLoading(true);
    try {
      // Fetch vendor
      const { data: vendorData, error: vendorError } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (vendorError) throw vendorError;
      setVendor(vendorData);

      // Fetch categories
      const { data: categoryData, error: categoryError } = await supabase
        .from('product_categories')
        .select('*')
        .eq('vendor_id', id)
        .order('sort_order');

      if (categoryError) throw categoryError;
      setCategories(categoryData || []);

      // Fetch products
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', id)
        .eq('is_available', true)
        .order('name');

      if (productError) throw productError;
      setProducts(productData || []);

      // Fetch combos
      const { data: combosData, error: combosError } = await supabase
        .from('combos')
        .select('*')
        .eq('vendor_id', id)
        .eq('is_available', true)
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
            product: productData?.find((p) => p.id === item.product_id),
          }));

          return { ...combo, items: itemsWithProducts };
        })
      );

      setCombos(combosWithItems);
    } catch (error) {
      console.error('Error fetching vendor:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const filteredProducts = products.filter(product => {
    const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory;
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading menu...</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Vendor not found</h2>
          <p className="text-muted-foreground mb-4">This vendor may no longer be available</p>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
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

      {/* Search */}
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

      {/* Category Tabs */}
      {categories.length > 0 && (
        <MenuCategoryTabs
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
        />
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
              <ComboCard key={combo.id} combo={combo} vendor={vendor} />
            ))}
          </div>
        </section>
      )}

      {/* Products Grid */}
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
              />
            ))}
          </div>
        )}
      </main>

      <CartButton />
      <BottomNav />
    </div>
  );
}
