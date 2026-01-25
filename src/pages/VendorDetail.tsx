import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { VendorHeader } from '@/components/vendor/VendorHeader';
import { MenuCategoryTabs } from '@/components/vendor/MenuCategoryTabs';
import { ProductCard } from '@/components/vendor/ProductCard';
import { CartButton } from '@/components/cart/CartButton';
import { BottomNav } from '@/components/home/BottomNav';
import { ArrowLeft, Leaf, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Product = Tables<'products'>;
type ProductCategory = Tables<'product_categories'>;

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchVendorData();
    }
  }, [id]);

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
    } catch (error) {
      console.error('Error fetching vendor:', error);
    } finally {
      setLoading(false);
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
      {/* Back Button */}
      <div className="fixed top-4 left-4 z-30">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate(-1)}
          className="rounded-full shadow-lg bg-background/90 backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5" />
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

      {/* Products Grid */}
      <main className="container py-4">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchQuery ? 'No items match your search' : 'No items available'}
            </p>
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
